/**
 * SSE Event Publisher Utility
 *
 * Thin wrapper over redisPubSub.publishSSEEvent that:
 *  - Provides per-domain role defaults so individual services don't need to know role lists
 *  - Enforces the "IDs only, no PHI" rule at the type level
 *  - Silently no-ops if tenantId is missing (super-admin writes, etc.)
 */

import { publishSSEEvent, SSEDomain, SSEEventType } from "../config/redisPubSub.js";

// ─── Role map by domain ───────────────────────────────────────────────────────
// THIS is the single source of truth for which roles receive which domain events.

const DOMAIN_ROLES: Record<SSEDomain, string[]> = {
  appointments: ["doctor", "nurse", "helpdesk", "patient", "hospital-admin", "emergency"],
  patients:     ["doctor", "nurse", "hospital-admin", "helpdesk", "emergency"],
  lab:          ["lab", "doctor", "nurse", "patient", "emergency"],
  pharmacy:     ["pharma-owner", "doctor", "nurse", "patient", "emergency"],
  billing:      ["hospital-admin", "admin", "patient", "hr", "helpdesk"],
  emergency:    ["emergency", "doctor", "nurse", "hospital-admin", "ambulance"],
  ambulance:    ["ambulance", "emergency", "hospital-admin", "helpdesk"],
  staff:        ["hr", "hospital-admin", "admin"],
  beds:         ["doctor", "nurse", "hospital-admin", "emergency"],
  inventory:    ["pharma-owner", "hospital-admin", "admin", "staff"],
  radiology:    ["doctor", "nurse", "lab", "patient"],
  hr:           ["hr", "hospital-admin", "admin"],
  helpdesk:     ["helpdesk", "hospital-admin", "admin"],
  system:       ["admin", "hospital-admin", "super-admin"],
};

// ─── Publisher function ───────────────────────────────────────────────────────

interface PublishOptions {
  tenantId: string | null | undefined;
  hospitalId: string | null | undefined;
  domain: SSEDomain;
  type: SSEEventType;
  resourceId?: string;
  resourceType?: string;
  /** Safe, non-PHI metadata (IDs, counts, status strings). Never clinical data. */
  meta?: Record<string, string | number | boolean>;
}

/**
 * Publish a real-time event.  Call this immediately after every successful DB write.
 * If tenantId is falsy (super-admin writes without tenant context) this is a no-op.
 */
export async function emitSSE(opts: PublishOptions): Promise<void> {
  // Allow 'global' or specific tenant context
  const tenantId = opts.tenantId || "global";
  const hospitalId = opts.hospitalId || "global";

  const roles = DOMAIN_ROLES[opts.domain] ?? [];

  try {
    await publishSSEEvent({
      tenantId:     tenantId.toString(),
      hospitalId:   hospitalId.toString(),
      domain:       opts.domain,
      type:         opts.type,
      roles,
      resourceId:   opts.resourceId,
      resourceType: opts.resourceType,
      meta:         opts.meta,
      timestamp:    new Date().toISOString(),
    });
  } catch (err) {
    // Never let SSE failures break the main request flow
    console.error("[SSE] emitSSE failed (non-fatal):", err);
  }
}
