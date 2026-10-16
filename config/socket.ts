import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import logger from "../utils/logger.js";

let io: Server | null = null;

export const initSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const parseOrigins = (raw?: string): string[] => {
          if (!raw) return [];
          return raw
            .split(",")
            .map((url) => {
              let o = url.trim();
              if (o && !/^https?:\/\//i.test(o)) {
                o = `https://${o}`;
              }
              return o.replace(/\/+$/, "");
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

        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

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
            return callback(null, true);
          }
        } catch {
          // invalid url
        }

        logger.warn(`[Socket CORS] Blocked origin: ${origin}`);
        return callback(new Error(`CORS: Origin ${origin} not allowed`));
      },
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
      credentials: true,
    },
  });

  logger.info("📡 Socket.IO initialized");
  return io;
};

/**
 * Returns the Socket.IO server instance, or null if not yet initialized.
 * Prefer safeEmit() in controllers to avoid hard crashes.
 */
export const getIO = (): Server | null => io;

/**
 * Fire-and-forget helper for emitting socket events from controllers.
 * Silently no-ops when Socket.IO is not initialized instead of throwing.
 */
export const safeEmit = (
  room: string,
  event: string,
  payload: unknown
): void => {
  if (!io) return;
  try {
    io.to(room).emit(event, payload);
  } catch (err) {
    logger.warn(`[Socket] safeEmit to room '${room}' event '${event}' failed: ${(err as Error).message}`);
  }
};

export { io };
