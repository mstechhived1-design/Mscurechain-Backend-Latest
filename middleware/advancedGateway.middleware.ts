// Advanced API Gateway Middleware
// Features: Circuit breaker, request queuing, distributed rate limiting, health monitoring

import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import redisService from "../config/redis.js";

// ==================== CIRCUIT BREAKER ====================

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";

  constructor(private config: CircuitBreakerConfig) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
        this.state = "HALF_OPEN";
        console.log("🔄 [Circuit Breaker] Attempting recovery (HALF_OPEN)");
      } else {
        throw new Error("Circuit breaker is OPEN - service unavailable");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    if (this.state === "HALF_OPEN") {
      this.state = "CLOSED";
      console.log("✅ [Circuit Breaker] Recovered (CLOSED)");
    }
  }

  public onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.config.failureThreshold) {
      this.state = "OPEN";
      console.error("❌ [Circuit Breaker] OPENED - Too many failures");
    }
  }

  getState() {
    return this.state;
  }
}

// Global circuit breaker instance
const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  monitoringPeriod: 10000, // 10 seconds
});

// ==================== REQUEST QUEUE ====================

class RequestQueue {
  private queue: Array<{
    req: Request;
    res: Response;
    next: NextFunction;
    timestamp: number;
  }> = [];
  private processing: boolean = false;
  private maxQueueSize: number = 1000;
  private concurrentLimit: number = 100;
  private currentProcessing: number = 0;

  async enqueue(req: Request, res: Response, next: NextFunction) {
    if (this.queue.length >= this.maxQueueSize) {
      return res.status(503).json({
        success: false,
        error: "Server overloaded - request queue full",
      });
    }

    this.queue.push({ req, res, next, timestamp: Date.now() });
    this.processQueue();
  }

  private async processQueue() {
    if (this.processing || this.currentProcessing >= this.concurrentLimit) {
      return;
    }

    this.processing = true;

    while (
      this.queue.length > 0 &&
      this.currentProcessing < this.concurrentLimit
    ) {
      const item = this.queue.shift();
      if (!item) break;

      // Check if request has timed out (30 seconds)
      if (Date.now() - item.timestamp > 30000) {
        item.res.status(408).json({
          success: false,
          error: "Request timeout",
        });
        continue;
      }

      this.currentProcessing++;

      // Process request
      item.next();

      // Decrement after a small delay
      setTimeout(() => {
        this.currentProcessing--;
        this.processQueue();
      }, 10);
    }

    this.processing = false;
  }

  getStats() {
    return {
      queueSize: this.queue.length,
      currentProcessing: this.currentProcessing,
      maxQueueSize: this.maxQueueSize,
      concurrentLimit: this.concurrentLimit,
    };
  }
}

const requestQueue = new RequestQueue();

// ==================== DISTRIBUTED RATE LIMITING ====================

/**
 * Distributed rate limiter using Redis
 */
export const distributedRateLimiter = async (
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> => {
  const now = Date.now();
  const windowKey = `ratelimit:${key}:${Math.floor(now / (windowSeconds * 1000))}`;

  try {
    const start = Date.now();
    const count = await redisService.incr(windowKey);
    const end = Date.now();

    if (end - start > 100) {
      console.warn(
        `🐢 [Redis] incr took ${end - start}ms for key ${windowKey}`,
      );
    }

    if (count === 1) {
      // Set expiry on first increment
      await redisService.setex(windowKey, windowSeconds, "1");
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
    };
  } catch (error) {
    // Fallback to allow on Redis error
    return { allowed: true, remaining: limit };
  }
};

// ==================== MIDDLEWARES ====================

/**
 * Circuit breaker middleware
 */
export const circuitBreakerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (circuitBreaker.getState() === "OPEN") {
    return res.status(503).json({
      success: false,
      error: "Service temporarily unavailable - circuit breaker open",
      retryAfter: 60,
    });
  }
  next();
};

/**
 * Request queue middleware (for high load scenarios)
 */
export const requestQueueMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const queueStats = requestQueue.getStats();

  // If system is overloaded, queue the request
  if (queueStats.currentProcessing >= queueStats.concurrentLimit * 0.8) {
    console.warn(`⚠️  [Queue] System load high - queueing request`);
    requestQueue.enqueue(req, res, next);
  } else {
    next();
  }
};

/**
 * Enhanced rate limiter with Redis
 */
export const enhancedRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Rate limiting disabled for authenticated requests per user request.
  // Login/Logout limits are maintained in Auth/rateLimitMiddleware.ts
  next();
};

/**
 * Request size limiter
 */
export const requestSizeLimiter = (maxSizeBytes: number = 50 * 1024 * 1024) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers["content-length"] || "0");

    if (contentLength > maxSizeBytes) {
      return res.status(413).json({
        success: false,
        error: "Request payload too large",
        maxSize: maxSizeBytes,
      });
    }

    next();
  };
};

/**
 * Response time monitor
 */
export const responseTimeMonitor = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  (req as any).markStage?.("res-monitor-start");
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;

    // Log slow requests
    if (duration > 3000) {
      console.error(
        `🚨 [Performance] CRITICAL SLOW REQUEST: ${req.method} ${req.originalUrl} - ${duration}ms`,
      );
    } else if (duration > 1000) {
      console.warn(
        `⚠️  [Performance] Slow request: ${req.method} ${req.originalUrl} - ${duration}ms`,
      );
    }

    // Track in Redis for analytics
    const key = `metrics:response_time:${req.method}:${req.route?.path || req.path}`;
    redisService.incr(key).catch(() => {});
  });

  next();
};

/**
 * Request ID generator
 */
export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  (req as any).markStage?.("req-id-start");
  const requestId = crypto.randomUUID();
  (req as any).requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
};

/**
 * Security headers
 */
export const securityHeaders = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
};

/**
 * Request logger with details
 */
export const detailedRequestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const user = (req as any).user;
  const requestId = (req as any).requestId;

  //   console.log(`[${requestId}] ${req.method} ${req.originalUrl}`, {
  //     user: user?.email || 'anonymous',
  //     role: user?.role || 'none',
  //     ip: req.ip,
  //   });

  next();
};

/**
 * Error recovery middleware
 */
export const errorRecovery = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const requestId = (req as any).requestId;

  console.error(`[${requestId}] Error:`, {
    error: err.message,
    stack: err.stack,
    path: req.originalUrl,
  });

  // Track error in circuit breaker
  circuitBreaker.onFailure();

  const statusCode = err.statusCode || err.status || 500;
  const isOperational = err.isOperational || false;

  // Don't expose internal errors in production
  const message =
    process.env.NODE_ENV === "production" && !isOperational
      ? "Internal server error"
      : err.message;

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      code: err.code || "INTERNAL_ERROR",
      requestId,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    },
  });
};

/**
 * Health check endpoint
 */
export const healthCheck = async (req: Request, res: Response) => {
  const dbHealthy = await checkDatabaseHealth();
  const cacheHealthy = await redisService.healthCheck();

  const health = {
    status: dbHealthy && cacheHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbHealthy ? "connected" : "disconnected",
    cache: cacheHealthy ? "connected" : "disconnected",
    circuitBreaker: circuitBreaker.getState(),
    queue: requestQueue.getStats(),
    memory: process.memoryUsage(),
  };

  const statusCode = health.status === "healthy" ? 200 : 503;
  res.status(statusCode).json(health);
};

/**
 * Metrics endpoint
 */
export const metricsEndpoint = async (req: Request, res: Response) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    circuitBreaker: {
      state: circuitBreaker.getState(),
    },
    queue: requestQueue.getStats(),
    cache: redisService.getStats(),
  };

  res.json(metrics);
};

// ==================== HELPER FUNCTIONS ====================

async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const { checkDBHealth } = await import("../config/db.js");
    return await checkDBHealth();
  } catch {
    return false;
  }
}

// ==================== EXPORT COMBINED GATEWAY ====================

/**
 * Pre-auth gateway: runs BEFORE protect()/authenticate.
 * Does NOT include enhancedRateLimiter because req.user is not yet populated here.
 */
export const advancedApiGateway = [
  requestIdMiddleware,
  securityHeaders,
  circuitBreakerMiddleware,
  requestSizeLimiter(50 * 1024 * 1024), // 50MB
  responseTimeMonitor,
  detailedRequestLogger,
  // ⚠️ enhancedRateLimiter intentionally excluded here.
  // It must run AFTER protect() so req.user is available.
  // Use postAuthRateLimiter in your route file after protect().
  // requestQueueMiddleware, // Enable in high-load scenarios
];

/**
 * Post-auth rate limiter: apply this AFTER protect() in your route file.
 * By this point req.user is populated so we rate-limit by userId, not by IP.
 */
export const postAuthRateLimiter = enhancedRateLimiter;

export default advancedApiGateway;
