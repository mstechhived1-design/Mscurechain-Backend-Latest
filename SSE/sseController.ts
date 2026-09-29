/**
 * SSE Controller
 *
 * Single protected endpoint that browser clients connect to for real-time events.
 *
 * Security guarantees:
 * - tenantId and role come exclusively from the verified JWT (never from client input)
 * - Per-event role filtering happens server-side before any write to the stream
 * - Heartbeat every 25s prevents proxy/LB from closing idle connections
 * - Full cleanup on client disconnect
 */

import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  registerSSEClient,
  unregisterSSEClient,
  SSEClient,
} from "../config/redisPubSub.js";

export const sseHandler = async (req: Request, res: Response): Promise<void> => {
  // ── 1. Authenticate ──────────────────────────────────────────────────────────
  let token: string | undefined;

  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    res.status(401).json({ message: "SSE: Authentication required." });
    return;
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET as string);
  } catch {
    res.status(401).json({ message: "SSE: Invalid or expired token." });
    return;
  }

  // ── 2. Extract identity from token only ──────────────────────────────────────
  // tenantId = hospitalId from JWT. NEVER from query/body/headers from client.
  const userId: string = decoded._id || decoded.id;
  const role: string = (decoded.role || "").toLowerCase();
  const tenantId: string = decoded.hospitalId || ""; // empty for super-admin / patient

  if (!userId || !role) {
    res.status(401).json({ message: "SSE: Malformed token payload." });
    return;
  }

  // ── 3. Set SSE headers ───────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering
  res.flushHeaders();

  // ── 4. Send initial connection confirmation ───────────────────────────────────
  res.write(
    `data: ${JSON.stringify({ type: "connected", userId, role, tenantId, timestamp: new Date().toISOString() })}\n\n`
  );

  // ── 5. Register client ───────────────────────────────────────────────────────
  const client: SSEClient = {
    res,
    userId,
    tenantId: tenantId || "global", // super-admin / patient fall into "global" channel
    role,
  };
  registerSSEClient(client);

  // ── 6. Heartbeat (25s interval to prevent proxy timeout) ────────────────────
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  // ── 7. Cleanup on disconnect ──────────────────────────────────────────────────
  req.on("close", () => {
    clearInterval(heartbeat);
    unregisterSSEClient(client);
  });

  req.on("error", () => {
    clearInterval(heartbeat);
    unregisterSSEClient(client);
  });
};
