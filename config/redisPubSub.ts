/**
 * Redis Pub/Sub Infrastructure
 *
 * ARCHITECTURE:
 * - One dedicated publisher Redis client (never used for subscribe)
 * - One shared subscriber per tenant channel (fan-out in-memory to N users)
 * - This keeps Redis connection count bounded by number of active tenants,
 *   NOT by the number of connected users — critical for Atlas free tier.
 *
 * Channel naming: `sse:tenant:<tenantId>` — every event for a tenant is
 * published on this single channel; server-side role filtering decides
 * which SSE clients actually receive each message.
 */

import { Redis } from "ioredis";
import { Response } from "express";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SSEDomain =
  | "appointments"
  | "patients"
  | "lab"
  | "pharmacy"
  | "billing"
  | "emergency"
  | "ambulance"
  | "staff"
  | "beds"
  | "inventory"
  | "radiology"
  | "hr"
  | "helpdesk"
  | "system";

export type SSEEventType =
  | "created"
  | "updated"
  | "deleted"
  | "status_changed"
  | "assigned"
  | "completed";

export interface SSEEvent {
  tenantId: string;
  hospitalId: string;
  domain: SSEDomain;
  type: SSEEventType;
  roles: string[];          // Roles that should receive this event
  resourceId?: string;      // The changed document's _id (never PHI)
  resourceType?: string;    // e.g. "Appointment", "LabOrder"
  meta?: Record<string, string | number | boolean>; // Safe, non-PHI metadata
  timestamp: string;
}

// ─── SSE Client Registry ──────────────────────────────────────────────────────

export interface SSEClient {
  res: Response;
  userId: string;
  tenantId: string;
  role: string;
}

// tenantId → Set of SSEClient
const tenantClients = new Map<string, Set<SSEClient>>();

// tenantId → active Redis subscriber instance
const tenantSubscribers = new Map<string, Redis>();

// ─── Publisher Client ──────────────────────────────────────────────────────────
// Dedicated publisher; never issues SUBSCRIBE/PSUBSCRIBE commands.

let _publisher: Redis | null = null;

function getPublisher(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  if (!_publisher) {
    _publisher = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    _publisher.on("error", (e) =>
      console.error("[SSE Publisher] Redis error:", e.message)
    );
    _publisher.connect().catch((e) =>
      console.error("[SSE Publisher] connect failed:", e.message)
    );
  }
  return _publisher;
}

// ─── Channel Helper ───────────────────────────────────────────────────────────

function tenantChannel(tenantId: string): string {
  return `sse:tenant:${tenantId}`;
}

// ─── Publish ──────────────────────────────────────────────────────────────────

/**
 * Publish a domain event to all connected users of this tenant.
 * Called by service layer functions after successful DB writes.
 * Falls back to direct in-process fan-out when Redis is unavailable.
 */
export async function publishSSEEvent(event: SSEEvent): Promise<void> {
  const pub = getPublisher();

  if (pub) {
    // Primary path: publish through Redis
    try {
      await pub.publish(tenantChannel(event.tenantId), JSON.stringify(event));
      return;
    } catch (e) {
      console.warn("[SSE Publish] Redis publish failed, falling back to in-process:", e);
    }
  }

  // Fallback: direct in-process delivery (single-instance dev/test scenarios)
  deliverToTenantClients(event.tenantId, event);
}

// ─── Subscriber Management ────────────────────────────────────────────────────

function deliverToTenantClients(tenantId: string, event: SSEEvent): void {
  const clients = tenantClients.get(tenantId);
  if (!clients || clients.size === 0) return;

  const payload = `data: ${JSON.stringify(event)}\n\n`;

  for (const client of clients) {
    // Server-side role filter — drop if this client's role isn't in the event's role list
    if (!event.roles.includes(client.role)) continue;

    try {
      client.res.write(payload);
    } catch (e) {
      // Silently drop — cleanup will remove this client on disconnect
    }
  }
}

function ensureTenantSubscriber(tenantId: string): void {
  if (tenantSubscribers.has(tenantId)) return; // Already subscribed

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    // No Redis — in-process fan-out handled by publishSSEEvent fallback
    return;
  }

  const sub = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // Reconnect forever — subscribers need persistence
    enableReadyCheck: false,
    lazyConnect: true,
  });

  sub.on("error", (e) =>
    console.error(`[SSE Sub:${tenantId}] Redis error:`, e.message)
  );

  sub.on("message", (_channel: string, message: string) => {
    try {
      const event: SSEEvent = JSON.parse(message);
      deliverToTenantClients(tenantId, event);
    } catch (e) {
      console.error(`[SSE Sub:${tenantId}] Failed to parse message:`, e);
    }
  });

  sub
    .connect()
    .then(() => sub.subscribe(tenantChannel(tenantId)))
    .then(() =>
      console.log(`[SSE] Subscribed to tenant channel: ${tenantId}`)
    )
    .catch((e) =>
      console.error(`[SSE Sub:${tenantId}] Subscribe failed:`, e.message)
    );

  tenantSubscribers.set(tenantId, sub);
}

function maybeUnsubscribeTenant(tenantId: string): void {
  const clients = tenantClients.get(tenantId);
  if (clients && clients.size > 0) return; // Still has connected users

  const sub = tenantSubscribers.get(tenantId);
  if (sub) {
    sub
      .unsubscribe(tenantChannel(tenantId))
      .then(() => sub.quit())
      .catch(() => sub.disconnect())
      .finally(() => {
        tenantSubscribers.delete(tenantId);
        tenantClients.delete(tenantId);
        console.log(`[SSE] Unsubscribed from idle tenant channel: ${tenantId}`);
      });
  }
}

// ─── Client Lifecycle ─────────────────────────────────────────────────────────

export function registerSSEClient(client: SSEClient): void {
  const { tenantId } = client;

  if (!tenantClients.has(tenantId)) {
    tenantClients.set(tenantId, new Set());
  }
  tenantClients.get(tenantId)!.add(client);

  // Subscribe to Redis channel for this tenant if first user
  ensureTenantSubscriber(tenantId);

  console.log(
    `[SSE] Client registered: ${client.userId} (${client.role}) for tenant ${tenantId}. ` +
    `Total for tenant: ${tenantClients.get(tenantId)!.size}`
  );
}

export function unregisterSSEClient(client: SSEClient): void {
  const { tenantId } = client;
  const clients = tenantClients.get(tenantId);
  if (clients) {
    clients.delete(client);
    console.log(
      `[SSE] Client unregistered: ${client.userId}. ` +
      `Remaining for tenant: ${clients.size}`
    );
  }
  maybeUnsubscribeTenant(tenantId);
}
