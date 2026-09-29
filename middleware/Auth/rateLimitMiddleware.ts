import { Request, Response, NextFunction } from "express";
import { redisService } from "../../config/redis.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

interface RateLimitConfig {
  windowMs: number;
  max: number;
  message: string;
}

/**
 * AUTH RATE LIMITER
 * Redis-based rate limiting for authentication endpoints.
 * Task 10: Supports both IP-based and User-based (if available) limiting.
 */
export const createRateLimiter = (config: RateLimitConfig & { useIdentifier?: boolean }) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Task 10: identifier can be email, mobile, or userId strings in the body/req
    const identifier = config.useIdentifier ? (req.body?.email || req.body?.mobile || req.body?.identifier || (req as any).user?._id) : "";
    const key = `ratelimit:${req.path}:${req.ip}${identifier ? `:${identifier}` : ""}`;

    try {
      const current = await redisService.incr(key);

      if (current === 1) {
        await redisService.expire(key, config.windowMs / 1000);
      }

      if (current > config.max) {
        console.warn(`[SECURITY] Rate Limit Blocked: path=${req.path} IP=${req.ip} id=${identifier || "none"} count=${current}`);
        return res.status(429).json({
          success: false,
          message: config.message,
          retryAfter: config.windowMs / 1000,
        });
      }

      next();
    } catch (err) {
      console.error("[RateLimit] Redis error:", err);

      // FIX: Fail-CLOSED in production — security > availability for auth endpoints
      if (IS_PRODUCTION) {
        return res.status(503).json({
          message: "Authentication service unavailable. Try again later.",
        });
      }

      next();
    }
  };
};

// Task 10: Hardened login limits (10 attempts per IP/User per 10 mins)
export const loginLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10, 
  useIdentifier: true, // Also track by login identifier (brute force protection)
  message: "Too many login attempts. Please try again after 10 minutes.",
});



export const passwordResetLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: "Too many password resets. Please try again in an hour.",
});

// Task 10: OTP/Email protection
export const emailLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  useIdentifier: true,
  message: "Daily email/OTP limit reached. Contact support if this is an error.",
});
