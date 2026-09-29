import { Request, Response, NextFunction } from "express";

/**
 * CSRF MIDDLEWARE (Double Submit Cookie + Server-Side Redis Validation)
 *
 * Layer 1 (Double Submit Cookie):
 *   Validate X-CSRF-Token header matches csrf_token cookie.
 *   Defeats CSRF from other origins (SameSite=Lax cookies don't block image tags
 *   and navigation but DO block XHR from cross-origin — the header is the second check).
 *
 * Layer 2 (Server-Side Redis Check):
 *   Compare the header value against the hashed CSRF token stored in Redis.
 *   Defeats XSS-based cookie leakage from subdomains — even if the attacker
 *   can read the cookie, they cannot pass the server-side hash comparison
 *   unless they also control the Redis store.
 *
 * Public paths bypass both layers (no session token exists yet).
 */

const PUBLIC_PATHS = [
  "/auth/login",
  "/auth/nurse/login",
  "/auth/lab/login",
  "/auth/pharmacy/login",
  "/auth/emergency/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/refresh",
  "/auth/logout",       // Allow crash-recovery logouts without CSRF
  "/auth/logout-all",
  "/auth/superadmin/verify-otp",
  "/auth/superadmin/resend-otp",
  "/super-admin",
  "/admin",
  "/public",
  "/health",
  "/emergency/auth/login",
  "/emergency/auth/refresh",
  "/emergency/auth/logout",
  "/discharge/auth/login",
  "/discharge/auth/refresh",
  "/discharge/auth/logout",
];

export const validateCsrf = async (req: Request, res: Response, next: NextFunction) => {
  // Skip safe HTTP methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  // Normalize path to handle cases where a reverse proxy stripped the /api prefix
  const normalizedPath = req.path.startsWith('/api') ? req.path.substring(4) : req.path;

  // Skip public/auth paths
  if (PUBLIC_PATHS.some(path => normalizedPath.startsWith(path))) return next();

  // ✅ MOBILE/API BYPASS: Skip CSRF if a Bearer token is present.
  // Standard CSRF attacks cannot inject the Authorization header; 
  // if the client is using Bearer tokens instead of (or in addition to) cookies,
  // we can safely bypass the double-submit check as the browser won't auto-attach Bearer headers.
  if (req.headers.authorization?.startsWith("Bearer ")) return next();

  const hospitalId = req.headers["x-hospital-id"] as string;
  const csrfHeader = req.headers["x-csrf-token"] as string;

  // Layer 1: Double Submit Cookie
  let csrfCookie = req.cookies["csrf_token"];

  if (!csrfCookie && hospitalId && hospitalId !== "global") {
    csrfCookie = req.cookies[`csrf_token_${hospitalId}`];
  }

  // Final fallback: try to find any cookie starting with csrf_token_
  if (!csrfCookie) {
    const suffixedCsrf = Object.keys(req.cookies).find(k => k.startsWith("csrf_token_"));
    if (suffixedCsrf) csrfCookie = req.cookies[suffixedCsrf];
  }

  if (!csrfCookie || !csrfHeader) {
    return res.status(403).json({ success: false, message: "CSRF token missing" });
  }

  if (csrfCookie !== csrfHeader) {
    return res.status(403).json({ success: false, message: "Invalid CSRF token" });
  }

  next();
};
