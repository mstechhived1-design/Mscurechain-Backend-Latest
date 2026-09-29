/**
 * SSE Auto-Emit Middleware
 *
 * Intercepts the Express res.json() call on every successful mutation
 * (POST / PUT / PATCH / DELETE) and fires an SSE event automatically.
 *
 * This approach ensures 100% mutation coverage without touching individual
 * controllers.  It derives the domain from the URL path segment and the
 * tenant/role identity from the already-attached req.user object that the
 * protect middleware has set.  All values come from the server — no client
 * input is trusted.
 *
 * Per-domain "which roles receive this" is handled by emitSSE internally
 * (single source of truth in utils/ssePublisher.ts).
 */

import { Request, Response, NextFunction } from "express";
import { emitSSE } from "../utils/ssePublisher.js";
import type { SSEDomain, SSEEventType } from "../config/redisPubSub.js";

// ─── Path → Domain mapping ────────────────────────────────────────────────────
// Maps URL path segments to SSE domain keys.  Unknown segments are silently
// ignored (no event emitted).

const PATH_TO_DOMAIN: Record<string, SSEDomain> = {
  bookings:       "appointments",
  appointments:   "appointments",
  patients:       "patients",
  ipd:            "patients",
  admissions:     "patients",
  discharge:      "patients",
  lab:            "lab",
  "walk-in":      "lab",
  pharmacy:       "pharmacy",
  billing:        "billing",
  emergency:      "emergency",
  "emergency-requests": "emergency",
  helpdesk:       "helpdesk",
  frontdesk:      "helpdesk",
  transits:       "ambulance",
  ambulance:      "ambulance",
  beds:           "beds",
  nurse:          "patients",
  staff:          "staff",
  attendance:     "staff",
  hr:             "hr",
  payroll:        "hr",
  recruitment:    "hr",
  leaves:         "hr",
  inventory:      "inventory",
  radiology:      "radiology",
  support:        "helpdesk",
  prescriptions:  "pharmacy",
  notifications:  "system",
  announcements:  "system",
  "hospital-admin": "system",
  hospital:       "system",
};

// ─── HTTP Method → SSE Event type ─────────────────────────────────────────────

function methodToEventType(method: string, url: string): SSEEventType {
  if (method === "DELETE") return "deleted";
  if (method === "POST") return "created";
  // PUT/PATCH — check if URL ends with a status-related segment
  const lower = url.toLowerCase();
  if (
    lower.includes("/status") ||
    lower.includes("/cancel") ||
    lower.includes("/complete") ||
    lower.includes("/approve") ||
    lower.includes("/reject") ||
    lower.includes("/activate") ||
    lower.includes("/deactivate") ||
    lower.includes("/discharge") ||
    lower.includes("/admit") ||
    lower.includes("/assign")
  ) {
    return "status_changed";
  }
  return "updated";
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export const autoEmitSSE = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Only intercept mutating methods
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    // Only emit on successful responses
    if (res.statusCode >= 200 && res.statusCode < 300) {
      // Derive domain from URL — url looks like /api/<segment>/...
      const parts = req.originalUrl.split("?")[0].split("/").filter(Boolean);
      // parts[0] === "api", parts[1] === segment
      const segment = parts[1] || "";
      const domain = PATH_TO_DOMAIN[segment];

      if (domain) {
        // tenantId from JWT payload (set by protect middleware) - NEVER from client
        const user = (req as any).user;
        const tenantId: string | undefined =
          user?.decoded?.hospitalId ||    // JWT claim (most reliable)
          user?.hospital?.toString() ||   // DB field
          (req as any).tenantId?.toString();

        const hospitalId = tenantId; // For tenant-scoped users they are identical

        if (tenantId) {
          const eventType = methodToEventType(req.method, req.originalUrl);

          // Extract resourceId safely from response body or URL
          const resourceId: string | undefined =
            data?.data?._id?.toString() ||
            data?._id?.toString() ||
            data?.data?.id?.toString() ||
            data?.id?.toString() ||
            parts[parts.length - 1]?.match(/^[0-9a-fA-F]{24}$/)
              ? parts[parts.length - 1]
              : undefined;

          // Fire-and-forget — never block the response
          emitSSE({
            tenantId,
            hospitalId: hospitalId!,
            domain,
            type: eventType,
            resourceId,
            resourceType: segment,
            meta: { method: req.method, status: res.statusCode },
          }).catch(() => {
            // Silently swallow — SSE must never affect the main response
          });
        }
      }
    }

    return originalJson(data);
  };

  next();
};
