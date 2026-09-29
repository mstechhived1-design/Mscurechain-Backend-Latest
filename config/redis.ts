// Production-Grade Redis Cache Service
// Features: Auto-fallback to in-memory, connection pooling, cluster support

import { Redis, Cluster } from "ioredis";
import NodeCache from "node-cache";

class RedisService {
  private client: Redis | Cluster | null = null;
  private fallbackCache: NodeCache;
  private isRedisAvailable: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  constructor() {
    // Initialize fallback in-memory cache
    const refreshExpiry = process.env.REFRESH_TOKEN_EXPIRY || "7d";
    const unit = refreshExpiry.slice(-1);
    const value = parseInt(refreshExpiry.slice(0, -1), 10) || 7;
    let ttlSeconds = 604800; // Default 7d
    switch (unit) {
      case "s": ttlSeconds = value; break;
      case "m": ttlSeconds = value * 60; break;
      case "h": ttlSeconds = value * 3600; break;
      case "d": ttlSeconds = value * 86400; break;
    }

    this.fallbackCache = new NodeCache({
      stdTTL: ttlSeconds, // Matches REFRESH_TOKEN_EXPIRY dynamically
      checkperiod: 3600, // Clean up hourly instead of every minute
      useClones: false,
    });

    this.initializeRedis();
  }

  /**
   * Initialize Redis connection with cluster support
   */
  private initializeRedis() {
    const redisUrl = process.env.REDIS_URL;
    const redisCluster = process.env.REDIS_CLUSTER === "true";

    if (!redisUrl) {
      console.log("ℹ️  [Redis] No REDIS_URL found, using in-memory cache");
      return;
    }

    try {
      if (redisCluster) {
        // Redis Cluster mode for production
        const clusterNodes = redisUrl.split(",").map((url) => {
          const urlObj = new URL(url);
          return {
            host: urlObj.hostname,
            port: parseInt(urlObj.port || "6379"),
          };
        });

        this.client = new Cluster(clusterNodes, {
          redisOptions: {
            password: process.env.REDIS_PASSWORD,
            tls: process.env.REDIS_TLS === "true" ? {} : undefined,
            connectTimeout: 5000,
            commandTimeout: 2000,
          },
          clusterRetryStrategy: (times) => {
            if (times > this.maxReconnectAttempts) {
              console.error("❌ [Redis] Max reconnection attempts reached");
              return null;
            }
            return Math.min(times * 100, 3000);
          },
        });
      } else {
        // Single Redis instance
        this.client = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          connectTimeout: 5000, // 5 seconds to connect
          commandTimeout: 2000, // 2 seconds per command
          retryStrategy: (times) => {
            if (times > this.maxReconnectAttempts) {
              console.error("❌ [Redis] Max reconnection attempts reached");
              return null;
            }
            return Math.min(times * 100, 3000);
          },
          lazyConnect: true,
        });
      }

      this.setupEventHandlers();
      this.connect();
    } catch (error) {
      console.error("❌ [Redis] Initialization error:", error);
      this.isRedisAvailable = false;
    }
  }

  /**
   * Setup Redis event handlers
   */
  private setupEventHandlers() {
    if (!this.client) return;

    this.client.on("connect", () => {
      console.log("✅ [Redis] Connected to Redis server");
      this.isRedisAvailable = true;
      this.reconnectAttempts = 0;
    });

    this.client.on("ready", () => {
      console.log("✅ [Redis] Redis client ready");
    });

    this.client.on("error", (error) => {
      console.error("❌ [Redis] Error:", error.message);
      this.isRedisAvailable = false;
    });

    this.client.on("close", () => {
      console.warn("⚠️  [Redis] Connection closed");
      this.isRedisAvailable = false;
    });

    this.client.on("reconnecting", () => {
      this.reconnectAttempts++;
      console.log(
        `🔄 [Redis] Reconnecting... (attempt ${this.reconnectAttempts})`,
      );
    });
  }

  /**
   * Connect to Redis
   */
  private async connect() {
    if (!this.client) return;

    try {
      await this.client.connect();
    } catch (error) {
      console.error("❌ [Redis] Connection failed:", error);
      this.isRedisAvailable = false;
    }
  }

  /**
   * Get value from cache (Redis or fallback)
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.isRedisAvailable && this.client) {
        const value = await this.client.get(key);
        if (value) {
          // console.log(`[Redis] HIT: ${key}`);
          return JSON.parse(value) as T;
        }
      } else {
        // Fallback to in-memory cache
        const value = this.fallbackCache.get<T>(key);
        if (value !== undefined) {
          // console.log(`[Cache] HIT: ${key}`);
          return value;
        }
      }
      // console.log(`[Cache] MISS: ${key}`);
      return null;
    } catch (error) {
      console.error("[Cache] Get error:", error);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(
    key: string,
    value: any,
    ttlSeconds: number = 300,
  ): Promise<boolean> {
    try {
      if (this.isRedisAvailable && this.client) {
        await this.client.setex(key, ttlSeconds, JSON.stringify(value));
        // console.log(`[Redis] SET: ${key} (TTL: ${ttlSeconds}s)`);
        return true;
      } else {
        // Fallback to in-memory cache
        this.fallbackCache.set(key, value, ttlSeconds);
        // console.log(`[Cache] SET: ${key} (TTL: ${ttlSeconds}s)`);
        return true;
      }
    } catch (error) {
      console.error("[Cache] Set error:", error);
      return false;
    }
  }

  /**
   * Delete key from cache
   */
  async del(key: string): Promise<boolean> {
    try {
      if (this.isRedisAvailable && this.client) {
        await this.client.del(key);
        // console.log(`[Redis] DEL: ${key}`);
      } else {
        this.fallbackCache.del(key);
        // console.log(`[Cache] DEL: ${key}`);
      }
      return true;
    } catch (error) {
      console.error("[Cache] Del error:", error);
      return false;
    }
  }

  /**
   * Delete keys matching pattern
   * FIX: Uses non-blocking SCAN instead of blocking KEYS command.
   * KEYS blocks all Redis operations on large datasets — SCAN is iterative and safe.
   */
  async delPattern(pattern: string): Promise<number> {
    try {
      if (this.isRedisAvailable && this.client) {
        const matchingKeys = await this.scanKeys(pattern);
        if (matchingKeys.length > 0) {
          await this.client.del(...matchingKeys);
          return matchingKeys.length;
        }
        return 0;
      } else {
        // Fallback to in-memory cache
        const keys = this.fallbackCache.keys();
        const regex = new RegExp(pattern.replace(/\*/g, ".*"));
        const matchingKeys = keys.filter((key) => regex.test(key));
        this.fallbackCache.del(matchingKeys);
        return matchingKeys.length;
      }
    } catch (error) {
      console.error("[Cache] DelPattern error:", error);
      return 0;
    }
  }

  /**
   * Non-blocking key scan using SCAN cursor iteration
   * Returns all matching keys without blocking Redis server
   */
  async scanKeys(pattern: string): Promise<string[]> {
    if (!this.isRedisAvailable || !this.client) return [];
    const matched: string[] = [];
    let cursor = "0";
    do {
      const result = await (this.client as any).scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = result[0];
      matched.push(...result[1]);
    } while (cursor !== "0");
    return matched;
  }

  /**
   * Increment counter (for rate limiting, analytics)
   */
  async incr(key: string): Promise<number> {
    try {
      if (this.isRedisAvailable && this.client) {
        return await this.client.incr(key);
      }

      // Fallback in-memory increment
      const current = this.fallbackCache.get<number>(key) || 0;
      const next = current + 1;
      // Use existing TTL or default to 24h for counters
      const ttl = this.fallbackCache.getTtl(key);
      const remainingSeconds = ttl ? Math.ceil((ttl - Date.now()) / 1000) : 86400;

      this.fallbackCache.set(key, next, Math.max(remainingSeconds, 0));
      return next;
    } catch (error) {
      console.error("[Cache] Incr error:", error);
      return 0;
    }
  }

  /**
   * Get TTL for a key
   */
  async ttl(key: string): Promise<number> {
    try {
      if (this.isRedisAvailable && this.client) {
        return await this.client.ttl(key);
      }
      const ttl = this.fallbackCache.getTtl(key);
      if (!ttl) return -2; // Not found
      return Math.ceil((ttl - Date.now()) / 1000);
    } catch (error) {
      console.error("[Cache] TTL error:", error);
      return -1;
    }
  }

  /**
   * Set expiry on an existing key
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      if (this.isRedisAvailable && this.client) {
        await this.client.expire(key, seconds);
        return true;
      }
      return this.fallbackCache.ttl(key, seconds);
    } catch (error) {
      console.error("[Cache] Expire error:", error);
      return false;
    }
  }

  /**
   * Set with expiry
   */
  async setex(key: string, seconds: number, value: string): Promise<boolean> {
    try {
      if (this.isRedisAvailable && this.client) {
        await this.client.setex(key, seconds, value);
        return true;
      } else {
        this.fallbackCache.set(key, value, seconds);
        return true;
      }
    } catch (error) {
      console.error("[Cache] Setex error:", error);
      return false;
    }
  }

  /**
   * Get multiple keys at once (pipeline)
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    try {
      if (this.isRedisAvailable && this.client) {
        return await this.client.mget(...keys);
      } else {
        return keys.map((key) => {
          const val = this.fallbackCache.get<string>(key);
          return val !== undefined ? val : null;
        });
      }
    } catch (error) {
      console.error("[Cache] Mget error:", error);
      return keys.map(() => null);
    }
  }

  /**
   * Flush all cache
   */
  async flush(): Promise<boolean> {
    try {
      if (this.isRedisAvailable && this.client) {
        await this.client.flushdb();
        // console.log('[Redis] FLUSH: All keys cleared');
      } else {
        this.fallbackCache.flushAll();
        // console.log('[Cache] FLUSH: All keys cleared');
      }
      return true;
    } catch (error) {
      console.error("[Cache] Flush error:", error);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    if (this.isRedisAvailable && this.client) {
      return {
        type: "redis",
        available: true,
        reconnectAttempts: this.reconnectAttempts,
      };
    } else {
      return {
        type: "in-memory",
        available: true,
        stats: this.fallbackCache.getStats(),
      };
    }
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.client) {
      await this.client.quit();
      console.log("🛑 [Redis] Connection closed");
    }
  }

  /**
   * Check if Redis is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (this.isRedisAvailable && this.client) {
        await this.client.ping();
        return true;
      }
      return true; // Fallback cache is always available
    } catch (error) {
      return false;
    }
  }
  /**
   * Check if Redis is currently available
   */
  public getIsRedisAvailable(): boolean {
    return this.isRedisAvailable;
  }
}

// Export singleton instance
export const redisService = new RedisService();
export default redisService;
