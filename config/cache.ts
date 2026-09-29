// Cache Service - Delegates to the unified RedisService
// This file previously used a hardcoded NodeCache (in-memory only).
// Now it delegates to redisService which uses:
//   → Redis (when REDIS_URL is set and server is reachable)
//   → NodeCache fallback (when Redis is unavailable)

import { redisService } from './redis.js';

// Re-export the redis service as the cacheService so all
// existing imports (cache.middleware.ts etc.) work without change.
export const cacheService = redisService;
export default cacheService;
