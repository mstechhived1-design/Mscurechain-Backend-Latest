// Cache Middleware - Makes API responses INSTANT!
import { Request, Response, NextFunction } from 'express';
import cacheService from '../config/cache.js';

/**
 * Cache middleware factory
 * @param ttl - Time to live in seconds (default: 1 minute)
 * @param keyPrefix - Prefix for cache keys
 */
export const cacheMiddleware = (ttl: number = 20, keyPrefix: string = 'api') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip cache for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    try {
      // Generate cache key from route + query + user
      const user = (req as any).user;
      const userId = user?._id?.toString() || user?.id || 'anonymous';
      
      // MULTI-TENANCY: Robust hospital ID resolution for cache scoping
      let hospitalId = user?.hospital?.toString() || 'default';
      
      // If user is a global/master role, prioritize the X-Hospital-Id header to correctly scope the cache
      const globalRoles = ["super-admin", "admin", "masterhelpdesk"];
      if (globalRoles.includes(user?.role)) {
        const headerHospId = req.headers["x-hospital-id"] || req.query.hospitalId;
        if (headerHospId) hospitalId = headerHospId.toString();
      }

      const cacheKey = `${keyPrefix}:${hospitalId}:${userId}:${req.originalUrl}`;

      // Try to get from cache
      const cachedData = await cacheService.get(cacheKey);
      
      if (cachedData) {
        console.log(`🟢 [Redis Cache] HIT: ${req.originalUrl}`);
        return res.status(200).json(cachedData);
      }
      console.log(`🔵 [Redis Cache] MISS: ${req.originalUrl}`);

      // Store original res.json
      const originalJson = res.json.bind(res);

      // Override res.json to cache the response
      res.json = function(data: any) {
        // Cache successful responses
        if (res.statusCode === 200) {
          cacheService.set(cacheKey, data, ttl)
            .then(() => {
              console.log(`💾 [Redis Cache] SET: ${req.originalUrl} (TTL: ${ttl}s)`);
            })
            .catch(err => console.error('[Cache] Store error:', err));
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      console.error('[Cache] Middleware error:', error);
      next();
    }
  };
};

/**
 * Auto-invalidates hospital cache on successful mutations (POST, PUT, PATCH, DELETE)
 */
export const autoInvalidateCache = (req: Request, res: Response, next: NextFunction) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
     const originalJson = res.json.bind(res);
     res.json = function(data: any) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const user = (req as any).user;
          let hospitalId = user?.hospital?.toString();
          
          const globalRoles = ["super-admin", "admin", "masterhelpdesk"];
          if (!hospitalId && globalRoles.includes(user?.role)) {
            hospitalId = (req.headers["x-hospital-id"] || req.query.hospitalId)?.toString();
          }

          if (hospitalId) {
           // Narrow invalidation: only clear cache keys matching this route segment
           const routeSegment = req.originalUrl.split('?')[0].split('/')[2] || 'api';
           invalidateCache(`*:${hospitalId}:*:*/${routeSegment}*`);
         }
       }
       return originalJson(data);
     };
  }
  next();
};

/**
 * Invalidate cache by pattern
 */
export const invalidateCache = async (pattern: string): Promise<void> => {
  try {
    await cacheService.delPattern(pattern);
    console.log(`🗑️ [Cache] Invalidated: ${pattern}`);
  } catch (error) {
    console.error('[Cache] Invalidation error:', error);
  }
};

/**
 * Invalidate all cache for a hospital
 */
export const invalidateHospitalCache = async (hospitalId: string): Promise<void> => {
  await invalidateCache(`*:${hospitalId}:*`);
};

export default cacheMiddleware;
