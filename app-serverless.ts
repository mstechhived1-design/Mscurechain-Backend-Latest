// Serverless-compatible version of app.ts (without Socket.IO)
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import { errorHandler, notFound } from './middleware/Error/errorMiddleware.js';

// Route imports
import authRoutes from "./Auth/Routes/authRoutes.js";
import patientRoutes from "./Patient/Routes/patientRoutes.js";
import doctorRoutes from "./Doctor/Routes/doctorRoutes.js";
import hospitalRoutes from "./Hospital/Routes/hospitalRoutes.js";
import superAdminRoutes from "./Admin/Routes/superAdminRoutes.js";
import hospitalAdminRoutes from "./Admin/Routes/hospitalAdminRoutes.js";
import helpDeskRoutes from "./Helpdesk/Routes/helpDeskRoutes.js";
import aiRoutes from "./AI/Routes/aiRoutes.js";
import bookingRoutes from "./Appointment/Routes/bookingRoutes.js";
import prescriptionRoutes from "./Prescription/Routes/prescriptionRoutes.js";
import prescriptionPDFRoutes from "./Prescription/Routes/prescriptionPDFRoutes.js";
import reportRoutes from "./Report/Routes/reportRoutes.js";
import messageRoutes from "./Messages/Routes/messageRoutes.js";
import leaveRoutes from "./Leave/Routes/leaveRoutes.js";
import notificationRoutes from "./Notification/Routes/notificationRoutes.js";
import noteRoutes from "./Note/Routes/noteRoutes.js";
import supportRoutes from "./Support/Routes/supportRoutes.js";

const app = express();

// Socket.IO is not available in serverless environment
// Controllers check for req.io before emitting, so they will gracefully degrade
app.use((req: Request, res: Response, next: NextFunction) => {
    (req as any).io = null; // Set to null for serverless (Socket.IO not supported)
    next();
});

// Health check endpoint - placed before CORS to allow public access
app.get('/api/health', (req: Request, res: Response) =>
    res.json({ status: 'ok', mode: 'serverless' }),
);

// CORS configuration - update with your frontend URL
const parseOrigins = (raw?: string): string[] => {
    if (!raw) return [];
    return raw
        .split(',')
        .map((url) => {
            let origin = url.trim();
            if (origin && !/^https?:\/\//i.test(origin)) {
                origin = `https://${origin}`;
            }
            return origin.replace(/\/+$/, "");
        })
        .filter(Boolean);
};

const allowedOrigins: string[] = Array.from(new Set([
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'https://dhruva-hospital.vercel.app',
    'https://www.mscurechain.com',
    'https://mscurechain.com',
    'https://hms-frontend-green.vercel.app',
    ...parseOrigins(process.env.FRONTEND_URL),
    ...parseOrigins(process.env.ALLOWED_ORIGINS),
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
]));

app.use(
    cors({
        origin: function (origin, callback) {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) {
                return callback(null, true);
            }

            // Check if origin is in allowed list
            if (allowedOrigins.includes(origin)) {
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

            // In development, allow all origins
            if (process.env.NODE_ENV === 'development') {
                return callback(null, true);
            }

            callback(new Error(`Not allowed by CORS: ${origin}`));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With', 'Accept', 'hospital-id', 'x-tenant-id'],
    }),
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/hospital-admin', hospitalAdminRoutes);
app.use('/api/helpdesk', helpDeskRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/prescriptions', prescriptionPDFRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/support', supportRoutes);

// Error handling middleware (must be after all routes)
app.use(notFound);
app.use(errorHandler);

export default app;
export { app };
