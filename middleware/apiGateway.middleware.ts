// API Gateway Middleware for Hospital Admin
// Provides: Rate limiting, validation, transformation, monitoring

import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

/**
 * Rate Limiter - Prevents API abuse
 */
/**
 * Rate Limiter - Disabled per user request
 */
export const apiRateLimiter = (req: Request, res: Response, next: NextFunction) => next();

/**
 * Strict Rate Limiter - Disabled per user request
 */
export const strictRateLimiter = (req: Request, res: Response, next: NextFunction) => next();

/**
 * Request Logger - Logs all API requests
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const start = Date.now();
  const user = (req as any).user;

  // Log request
  console.log(
    `[Gateway] ${req.method} ${req.originalUrl} - User: ${user?.id || "anonymous"}`,
  );

  // Capture response
  const originalJson = res.json.bind(res);
  res.json = function (data: any) {
    const duration = Date.now() - start;
    console.log(
      `[Gateway] ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`,
    );
    return originalJson(data);
  };

  next();
};

/**
 * Response Transformer - Standardizes API responses
 */
export const responseTransformer = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    // Skip transformation if already formatted
    if (
      data &&
      typeof data === "object" &&
      ("success" in data || "error" in data)
    ) {
      return originalJson(data);
    }

    // Transform response to standard format
    const transformed = {
      success: res.statusCode >= 200 && res.statusCode < 300,
      data: data,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    };

    return originalJson(transformed);
  };

  next();
};

/**
 * Error Handler - Catches and formats errors
 */
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.error("[Gateway] Error:", err);

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal server error";

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      code: err.code || "INTERNAL_ERROR",
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    },
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  });
};

/**
 * Request Validator - Validates common request patterns
 */
export const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Validate hospital access
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Authentication required",
    });
  }

  // Hospital admin can only access their own hospital
  if (
    user.role === "hospital-admin" &&
    req.body.hospitalId &&
    req.body.hospitalId !== user.hospital
  ) {
    return res.status(403).json({
      success: false,
      error: "Access denied to this hospital",
    });
  }

  next();
};

/**
 * Performance Monitor - Tracks slow requests
 */
export const performanceMonitor = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;

    // Log slow requests (> 1 second)
    if (duration > 1000) {
      console.warn(
        `[Gateway] ⚠️ SLOW REQUEST: ${req.method} ${req.originalUrl} - ${duration}ms`,
      );
    }

    // Log very slow requests (> 5 seconds)
    if (duration > 5000) {
      console.error(
        `[Gateway] 🚨 VERY SLOW REQUEST: ${req.method} ${req.originalUrl} - ${duration}ms`,
      );
    }
  });

  next();
};

/**
 * CORS Handler - Handles cross-origin requests
 */
export const corsHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const parseOrigins = (raw?: string): string[] => {
    if (!raw) return [];
    return raw
      .split(",")
      .map((url) => {
        let origin = url.trim();
        if (origin && !/^https?:\/\//i.test(origin)) {
          origin = `https://${origin}`;
        }
        return origin.replace(/\/+$/, "");
      })
      .filter(Boolean);
  };

  const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://[::1]:3000",
    "https://dhruva-hospital.vercel.app",
    "https://www.mscurechain.com",
    "https://mscurechain.com",
    "https://hms-frontend-green.vercel.app",
    ...parseOrigins(process.env.FRONTEND_URL),
    ...parseOrigins(process.env.ALLOWED_ORIGINS),
  ];

  const origin = req.headers.origin;
  const path = req.originalUrl || req.url || "";
  const isPublicRoute = path.startsWith("/api/public") || path.includes("/public/");

  let isAllowed = false;
  if (origin) {
    if (allowedOrigins.includes(origin) || isPublicRoute) {
      isAllowed = true;
    } else {
      try {
        const url = new URL(origin);
        const hostname = url.hostname;
        if (
          hostname.endsWith(".vercel.app") ||
          hostname === "mscurechain.com" ||
          hostname.endsWith(".mscurechain.com") ||
          hostname === "railway.app" ||
          hostname.endsWith(".railway.app") ||
          hostname === "localhost" ||
          hostname === "127.0.0.1" ||
          hostname === "[::1]" ||
          hostname.startsWith("192.168.") ||
          hostname.startsWith("10.") ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
        ) {
          isAllowed = true;
        }
      } catch {
        // invalid URL
      }
    }
  }

  if (origin && isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-CSRF-Token, X-Requested-With, Accept, hospital-id, x-tenant-id, x-hospital-id, Origin",
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
};

/**
 * Combine all gateway middlewares
 */
export const apiGateway = [
  corsHandler,
  requestLogger,
  performanceMonitor,
  apiRateLimiter,
  validateRequest,
  responseTransformer,
];

export default apiGateway;
