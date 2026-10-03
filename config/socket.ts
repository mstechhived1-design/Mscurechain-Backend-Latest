import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import logger from "../utils/logger.js";

let io: Server | null = null;

export const initSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const allowedOrigins = [
          "http://localhost:3000",
          "http://localhost:3001",
          "http://localhost:3002",
          "http://localhost:3003",
          "http://127.0.0.1:3000",
          "http://[::1]:3000",
          "https://www.mscurechain.com",
          "https://mscurechain.com",
          "https://hms-frontend-green.vercel.app",
          ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",").map(url => {
              let origin = url.trim();
              if (origin && !/^https?:\/\//i.test(origin)) {
                  origin = `https://${origin}`;
              }
              return origin.replace(/\/+$/, "");
          }) : []),
        ];

        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        // Allow any local network IP origin in development
        if (process.env.NODE_ENV !== "production") {
          if (origin.startsWith("http://192.168.") || origin.startsWith("http://10.") || origin.startsWith("http://172.")) {
            return callback(null, true);
          }
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
