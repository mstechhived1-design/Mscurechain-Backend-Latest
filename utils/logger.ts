import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import { getTenantContext } from "../middleware/tenantPlugin.js";

const { combine, timestamp, printf, colorize, json, errors, metadata } = winston.format;

// Log format for Console (Transports)
const consoleFormat = printf(({ level, message, timestamp, ...meta }) => {
  const context = getTenantContext();
  const tenantId = context.tenantId ? ` [TH:${context.tenantId}]` : "";
  const userId = context.userId ? ` [U:${context.userId}]` : "";
  const metaString = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : "";
  
  return `${timestamp} [${level}]${tenantId}${userId}: ${message}${metaString}`;
});

// JSON format for Files
const fileFormat = combine(
  timestamp(),
  errors({ stack: true }),
  metadata(),
  json()
);

const logDir = "logs";

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: fileFormat,
  defaultMeta: { service: "curechain-backend" },
  transports: [
    // 1. All Logs (Combined) - Daily Rotate
    new DailyRotateFile({
      dirname: path.join(logDir, "combined"),
      filename: "application-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
    }),

    // 2. Error Logs (Separate) - Daily Rotate
    new DailyRotateFile({
      level: "error",
      dirname: path.join(logDir, "errors"),
      filename: "error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "30d",
    }),

    // 3. Security/Audit External (Login/Logout, Auth failures)
    new DailyRotateFile({
      level: "info",
      dirname: path.join(logDir, "audit"),
      filename: "audit-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "90d",
    }),
  ],
  exitOnError: false, // Do not exit on handled exceptions
});

// Add console logging in development/staging
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: "HH:mm:ss" }), consoleFormat),
    })
  );
}

/**
 * Enhanced logging helper that captures tenant context automatically
 */
export const logAudit = (message: string, meta: object = {}) => {
  const context = getTenantContext();
  logger.info(message, {
    tenantId: context.tenantId,
    userId: context.userId,
    role: context.role,
    ...meta,
    type: "audit",
  });
};

export const logError = (message: string, error: any, meta: object = {}) => {
  const context = getTenantContext();
  logger.error(message, {
    ...meta,
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code || error.statusCode,
    },
    tenantId: context.tenantId,
    userId: context.userId,
  });
};

export default logger;
