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
  const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    ...(process.env.FRONTEND_URL
        ? process.env.FRONTEND_URL.split(',').map((url) => {
              let origin = url.trim();
              if (origin && !/^https?:\/\//i.test(origin)) {
                  origin = `https://${origin}`;
              }
              return origin.replace(/\/+$/, "");
          })
        : []),
  ].filter(Boolean);

  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
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
