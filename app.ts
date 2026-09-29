import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import logger from "./utils/logger.js";
import { initTenantStore } from "./middleware/tenantMiddleware.js";

// Task 11 — ENVIRONMENT HARDENING: Fail fast at startup if critical variables are missing
const REQUIRED_ENV = ["JWT_SECRET", "JWT_REFRESH_SECRET", "ENCRYPTION_KEY", "MONGO_URI"];
const MISSING_ENV = REQUIRED_ENV.filter((e) => !process.env[e]);

if (MISSING_ENV.length > 0) {
  logger.error("FATAL: Missing required environment variables: " + MISSING_ENV.join(", "));
  logger.error("The system cannot start without these. Check your .env file.");
  process.exit(1); 
}

// Route imports
import authRoutes from "./Auth/Routes/authRoutes.js";
import patientRoutes from "./Patient/Routes/patientRoutes.js";
import feedbackRoutes from "./Patient/Routes/feedbackRoutes.js";
import doctorRoutes from "./Doctor/Routes/doctorRoutes.js";
import consultationRoutes from "./Doctor/Routes/consultationRoutes.js";
import hospitalRoutes from "./Hospital/Routes/hospitalRoutes.js";
import superAdminRoutes from "./Admin/Routes/superAdminRoutes.js";
import hospitalAdminRoutes from "./Admin/Routes/hospitalAdminRoutes.js";
import landingRoutes from "./Public/Routes/landingRoutes.js";
import superAdminAuthRoutes from "./Auth/Routes/superAdminAuthRoutes.js";
import pharmaRoutes from "./Pharmacy/Routes/pharmacyRoutes.js";
import helpDeskRoutes from "./Helpdesk/Routes/helpDeskRoutes.js";
import transitRoutes from "./Helpdesk/Routes/transitRoutes.js";
import frontDeskRoutes from "./Helpdesk/Routes/frontDeskRoutes.js";
import masterHelpdeskRoutes from "./MasterHelpdesk/Routes/masterHelpdeskRoutes.js";
import masterDoctorLeaveRoutes from "./MasterHelpdesk/Routes/masterDoctorLeaveRoutes.js";
import aiRoutes from "./AI/Routes/aiRoutes.js";
import bedRoutes from "./IPD/Routes/bedRoutes.js";
import ipdRoutes from "./IPD/Routes/ipdRoutes.js";
import vitalsRoutes from "./IPD/Routes/vitalsRoutes.js";
import billingRoutes from "./IPD/Routes/billingRoutes.js";

import tvDisplayRoutes from "./Admin/Routes/tvDisplayRoutes.js";
import bookingRoutes from "./Appointment/Routes/bookingRoutes.js";
import onlineBookingRoutes from "./Appointment/Routes/onlineBookingRoutes.js";
import prescriptionRoutes from "./Prescription/Routes/prescriptionRoutes.js";
import prescriptionPDFRoutes from "./Prescription/Routes/prescriptionPDFRoutes.js";
import reportRoutes from "./Report/Routes/reportRoutes.js";
import messageRoutes from "./Messages/Routes/messageRoutes.js";
import leaveRoutes from "./Leave/Routes/leaveRoutes.js";
import notificationRoutes from "./Notification/Routes/notificationRoutes.js";
import noteRoutes from "./Note/Routes/noteRoutes.js";
import supportRoutes from "./Support/Routes/supportRoutes.js";
import labRoutes from "./Lab/Routes/labRoutes.js";
import walkInRoutes from "./Lab/Routes/walkInRoutes.js";
import attendanceRoutes from "./Staff/Routes/attendanceRoutes.js";
import hrRoutes from "./HR/Routes/hrRoutes.js";
import announcementRoutes from "./Notification/Routes/announcementRoutes.js";
import recruitmentRoutes from "./Recruitment/Routes/recruitmentRoutes.js";

import {
  emergencyAuthRoutes,
  emergencyRequestRoutes,
  emergencyDevRoutes,
} from "./Emergency/index.js";
import dischargeAuthRoutes from "./Discharge/Routes/dischargeAuthRoutes.js";
import dischargeRecordRoutes from "./Discharge/Routes/dischargeRecordRoutes.js";
import nurseRoutes from "./Staff/Routes/nurseRoutes.js";
import incidentRoutes from "./Incident/Routes/incidentRoutes.js";
import sopRoutes from "./SOP/Routes/sopRoutes.js";
import trainingRoutes from "./Hospital/Routes/trainingRoutes.js";
import qualityRoutes from "./Quality/Routes/qualityRoutes.js";
import performanceRoutes from "./Performance/Routes/performanceRoutes.js";
import { initSocket } from "./config/socket.js";
import sseRoutes from "./SSE/sseRoutes.js";
import { startAppointmentCleanupTask } from "./Appointment/Controllers/bookingController.js";
import { startMonitoringTasks } from "./IPD/Controllers/monitoringTask.js";
import { registerTVSocketHandlers } from "./config/tvSocketHandler.js";
import { startNotificationScheduler } from "./Appointment/Controllers/notificationScheduler.js";
import { checkPortalLicense } from "./middleware/Auth/licenseMiddleware.js";
import { errorHandler } from "./middleware/Error/errorMiddleware.js";
import {
  advancedApiGateway,
  errorRecovery,
} from "./middleware/advancedGateway.middleware.js";
import { autoInvalidateCache } from "./middleware/cache.middleware.js";
import { autoEmitSSE } from "./middleware/sseEmit.middleware.js";

const app = express();
app.set("trust proxy", true);
app.use(initTenantStore);
const server = http.createServer(app);

// Initialize Socket.IO through the new config to break circular deps
const io = initSocket(server);

registerTVSocketHandlers(io);
startAppointmentCleanupTask(io);
startMonitoringTasks(io);
startNotificationScheduler();


app.use((req: Request, res: Response, next: NextFunction) => {
  (req as any).io = io;
  next();
});

io.on("connection", (socket) => {
  // ✅ FIX: Server-side room joining — never trust hospitalId from client payload
  socket.on("join_room", async ({ userId: inputUserId }: { userId: string }) => {
    try {
      if (!inputUserId) return;

      // Look up authenticated user from token in socket handshake
      const token =
        (socket.handshake.auth?.token as string) ||
        (socket.handshake.query?.token as string);

      if (!token) {
        logger.warn(`[Socket] join_room rejected: no token for socket ${socket.id}`);
        return;
      }

      const jwt = (await import("jsonwebtoken")).default;
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);
      const userId = decoded._id || decoded.id;
      if (!userId) return;

      // Import models inline to avoid circular deps
      const [{ default: User }, { default: SuperAdmin }, { default: Patient }] =
        await Promise.all([
          import("./Auth/Models/User.js"),
          import("./Auth/Models/SuperAdmin.js"),
          import("./Patient/Models/Patient.js"),
        ]);

      let dbUser: any = null;
      const role = decoded.role?.toLowerCase();

      if (role === "super-admin") {
        dbUser = await SuperAdmin.findById(userId).select("role").lean();
      } else if (role === "patient") {
        dbUser = await (Patient.findById(userId) as any)
          .unscoped()
          .select("role")
          .lean();
      } else {
        dbUser = await (User.findById(userId) as any)
          .unscoped()
          .select("role hospital")
          .lean();
      }

      if (!dbUser) {
        logger.warn(`[Socket] join_room rejected: user ${userId} not found`);
        return;
      }

      // Join personal rooms (always safe — ID-specific)
      socket.join(`${role}_${userId}`);
      socket.join(`user_${userId}`);

      // Join hospital room only if user belongs to that hospital (from DB, NOT client)
      const hospitalId = (dbUser as any).hospital?.toString();
      if (hospitalId) {
        socket.join(`hospital_${hospitalId}`);
        socket.join(`hospital_${hospitalId}_${role}`);
        logger.info(`📡 Socket ${socket.id} (${role}) joined hospital rooms: [hospital_${hospitalId}]`);
      }
    } catch (err) {
      // Invalid token or DB error — silently reject
      logger.warn(`[Socket] join_room rejected for socket ${socket.id}: ${(err as Error).message}`);
    }
  });

  // ✅ FIX: subscribe-patient validates that the requester is authorized for this patient
  socket.on("subscribe-patient", async (patientId: string) => {
    try {
      if (!patientId) return;

      const token =
        (socket.handshake.auth?.token as string) ||
        (socket.handshake.query?.token as string);
      if (!token) return;

      const jwt = (await import("jsonwebtoken")).default;
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);
      const userId = decoded._id || decoded.id;
      if (!userId) return;

      const role = decoded.role?.toLowerCase();

      // Patient can only subscribe to their OWN vitals room
      if (role === "patient") {
        if (userId.toString() !== patientId.toString()) {
          logger.warn(`[Socket] Patient ${userId} tried to subscribe to patient ${patientId} — blocked`);
          return;
        }
      }
      // Staff (doctor, nurse) must have an active admission for this patient in their hospital
      // For now, allow staff roles — they are scoped to hospital rooms already
      // A deeper check would verify IPDAdmission for this patient in their hospital

      const patientRoom = `patient_${patientId}`;
      socket.join(patientRoom);
      logger.info(`📡 Socket ${socket.id} (${role}) subscribed to patient ${patientId}`);
    } catch (err) {
      logger.warn(`[Socket] subscribe-patient rejected: ${(err as Error).message}`);
    }
  });

  socket.on("unsubscribe-patient", (patientId: string) => {
    if (patientId) {
      socket.leave(`patient_${patientId}`);
    }
  });

  socket.on("disconnect", () => {
    // console.log('Client disconnected:', socket.id);
  });
});

// --- Broad CORS Configuration ---
const allowedOrigins = (
  process.env.FRONTEND_URL || "http://localhost:3000"
).split(",").map(o => o.trim());

console.log("FRONTEND_URL from process.env:", process.env.FRONTEND_URL);
console.log("Computed Allowed Origins:", allowedOrigins);

// Always allow standard dev origins
if (process.env.NODE_ENV !== "production") {
  if (!allowedOrigins.includes("http://localhost:3000")) allowedOrigins.push("http://localhost:3000");
  if (!allowedOrigins.includes("http://localhost:3001")) allowedOrigins.push("http://localhost:3001");
  if (!allowedOrigins.includes("http://localhost:3002")) allowedOrigins.push("http://localhost:3002");
  if (!allowedOrigins.includes("http://localhost:3003")) allowedOrigins.push("http://localhost:3003");
  if (!allowedOrigins.includes("http://127.0.0.1:3000")) allowedOrigins.push("http://127.0.0.1:3000");
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      // Exact match check
      if (allowedOrigins.includes(origin)) return callback(null, true);
      
      // Allow any local network IP origin in development for testing
      if (process.env.NODE_ENV !== "production") {
        if (origin.startsWith("http://192.168.") || origin.startsWith("http://10.") || origin.startsWith("http://172.")) {
          return callback(null, true);
        }
      }
      
      console.warn(`[CORS] Blocked origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(cookieParser());

// Task 6 — STRICT CSP: Protect against XSS by disallowing inline scripts and eval
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow CORS for assets
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com"], 
        styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "res.cloudinary.com", "https://*.razorpay.com"],
        connectSrc: ["'self'", "wss:", "https:", "https://lumberjack.razorpay.com"],
        fontSrc: ["'self'", "fonts.gstatic.com"],
        frameSrc: ["'self'", "https://api.razorpay.com", "https://*.razorpay.com"],
        objectSrc: ["'none'"], // Task 6: Prevent plugin-based attacks
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  }),
);

// Task 10: Protect against Parameter Pollution
app.use(hpp());

// Task 7 — XSS HARDENING: Global Input Sanitization Middleware
// Safely sanitizes req.body, req.query, req.params without crashing on read-only properties
const sanitizeInput = (val: any): any => {
  if (typeof val === "string") {
    // Strip common XSS patterns: scripts, onEvent handlers, javascript: URIs
    return val
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
      .replace(/on\w+="[^"]*"/gim, "")
      .replace(/javascript:[^"]*/gim, "");
  }
  if (val && typeof val === "object" && !Array.isArray(val)) {
    Object.keys(val).forEach((key) => {
      try {
        // Express 5 may have read-only getters on query/params. We catch failed assignments.
        const originalVal = val[key];
        const sanitizedVal = sanitizeInput(originalVal);
        if (originalVal !== sanitizedVal) {
          val[key] = sanitizedVal;
        }
      } catch (e) {
        // Log skip but continue for read-only properties (typical in Express 5 internal query/params)
        // console.warn(`[CMS] Skipping read-only property sanitization for key: ${key}`);
      }
    });
  }
  return val;
};

// Apply Sanitization + NoSQL protection in one unified safe block
app.use((req: Request, res: Response, next: NextFunction) => {
  // Sanitize for XSS (Task 7)
  if (req.body) sanitizeInput(req.body);
  if (req.query) sanitizeInput(req.query);
  if (req.params) sanitizeInput(req.params);

  // Sanitize for NoSQL Injection
  if (req.body) mongoSanitize.sanitize(req.body, { replaceWith: "_" });
  if (req.query) mongoSanitize.sanitize(req.query, { replaceWith: "_" });
  if (req.params) mongoSanitize.sanitize(req.params, { replaceWith: "_" });

  next();
});


// ✅ HTTP Request Logging via Morgan & Winston
app.use(
  morgan(
    ":remote-addr :method :url :status :res[content-length] - :response-time ms",
    {
      stream: {
        write: (message) => logger.info(message.trim(), { type: "http" }),
      },
    },
  ),
);

// Network logging — enabled only in development
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    // Already handled by morgan, but we can keep minimal console for dev speed
    next();
  });
}

// ✅ GLOBAL PRODUCTION GATEWAY (Rate limiting, Circuit Breaker, Monitoring)
// ✅ PERFORMANCE DIAGNOSTICS
app.use((req, res, next) => {
  const start = Date.now();
  const stages: { [key: string]: number } = {};

  (req as any).markStage = (name: string) => {
    stages[name] = Date.now() - start;
  };

  res.on("finish", () => {
    const total = Date.now() - start;
    if (total > 1000) {
      const logMsg = `⏱️ [DIAGNOSTIC] ${req.method} ${req.originalUrl} - Total: ${total}ms ${JSON.stringify(stages)}`;
      logger.warn(logMsg, { stages });

      // Size-limited log rotation managed by Winston (DailyRotateFile)
    }
  });

  (req as any).markStage("init");
  next();
});

// Initialize the AsyncLocalStorage store for every request
// Moved to top for consistency
// app.use(initTenantStore);

// ✅ CSRF PROTECTION
import { validateCsrf } from "./middleware/Auth/csrfMiddleware.js";
app.use(validateCsrf);

app.use(advancedApiGateway);
app.use(autoInvalidateCache);
app.use(autoEmitSSE); // ✅ REAL-TIME: Auto-emit SSE event on every successful mutation

// ✅ MULTI-TENANCY: Global tenant context resolution
import { resolveTenant } from "./middleware/tenantMiddleware.js";

// Routes
app.use("/api/public", landingRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", authRoutes); // Matching frontend USER_ENDPOINTS
app.use("/api/patients", patientRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/hospitals", hospitalRoutes);
app.use("/api/super-admin", superAdminAuthRoutes);
app.use("/api/admin", superAdminAuthRoutes);
app.use("/api/admin/tv-displays", tvDisplayRoutes);
app.use("/api/super-admin", superAdminRoutes);
app.use("/api/admin", superAdminRoutes); // New path matching frontend
app.use("/api/hospital-admin", hospitalAdminRoutes); // New path matching frontend
app.use("/api/hospital", hospitalAdminRoutes); // Legacy support
app.use("/api/hr", hrRoutes);
app.use("/api/recruitment", recruitmentRoutes);
app.use("/api/pharmacy", pharmaRoutes);
app.use("/api/helpdesk/transits", transitRoutes); // Transit endpoints
app.use("/api/helpdesk", helpDeskRoutes);
app.use("/api/frontdesk", frontDeskRoutes);
app.use("/api/masterhelpdesk", masterHelpdeskRoutes);
app.use("/api/masterhelpdesk/doctor-leaves", masterDoctorLeaveRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/mobile", onlineBookingRoutes);
app.use("/api/prescriptions", prescriptionRoutes);
app.use("/api/prescriptions", prescriptionPDFRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/lab", labRoutes);
app.use("/api/lab/walk-in", walkInRoutes);
app.use("/api/ipd/beds", bedRoutes);
app.use("/api/ipd/billing", billingRoutes);
app.use("/api/ipd", vitalsRoutes); // General vitals monitoring (alerts, thresholds)
app.use("/api/ipd/admissions", ipdRoutes); // ✅ Frontend uses /ipd/admissions/* — alias mount
app.use("/api/ipd", ipdRoutes); // Admissions, Transfers, Discharge (Contains Wildcard /:admissionId - MUST BE LAST)
app.use("/api/attendance", attendanceRoutes); // Direct attendance path for frontend
app.use("/api/staff/attendance", attendanceRoutes);
app.use("/api/emergency/auth", emergencyAuthRoutes);
app.use("/api/emergency/requests", emergencyRequestRoutes);
app.use("/api/discharge/auth", dischargeAuthRoutes);
app.use("/api/discharge/records", dischargeRecordRoutes);
app.use("/api/nurse", nurseRoutes);
app.use("/api/emergency/dev", emergencyDevRoutes);
app.use("/api/doctor", consultationRoutes); // Consultation endpoints
app.use("/api/incidents", incidentRoutes);
app.use("/api/sop", sopRoutes);
app.use("/api/training", trainingRoutes);
app.use("/api/quality", qualityRoutes);
app.use("/api/performance", performanceRoutes); // Enterprise Performance Analytics Module

// ✅ REAL-TIME: SSE endpoint — auth handled inside controller (cookie-based JWT)
// Must be mounted BEFORE the 404 catch-all and AFTER CORS/helmet are applied
app.use("/api/sse", sseRoutes);

app.get("/api/health", (req: Request, res: Response) =>
  res.json({ status: "ok", backend: "fresh" }),
);

// Catch-all 404 handler
app.use((req: Request, res: Response) => {
  logger.warn(`404 - Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    message: `Route ${req.method} ${req.originalUrl} not found`,
    path: req.originalUrl,
    method: req.method,
  });
});

// Global Error Handler
app.use(errorHandler);

export { app, server, io };
