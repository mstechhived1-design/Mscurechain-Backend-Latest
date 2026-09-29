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
const allowedOrigins: (string | undefined | null)[] = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://www.mscurechain.com',
    'https://mscurechain.com', // Support both www and non-www
    process.env.FRONTEND_URL,
    // Support multiple frontend URLs (comma-separated)
    ...(process.env.FRONTEND_URL
        ? process.env.FRONTEND_URL.split(',').map((url) => url.trim())
        : []),
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
].filter(Boolean);

app.use(
    cors({
        origin: function (origin, callback) {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) {
                // In production, be more strict - only allow if explicitly configured
                if (
                    process.env.NODE_ENV === 'production' &&
                    !process.env.ALLOW_NO_ORIGIN
                ) {
                    return callback(new Error('Not allowed by CORS'));
                }
                return callback(null, true);
            }

            // Check if origin is in allowed list
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            // In development, allow all origins
            if (process.env.NODE_ENV === 'development') {
                return callback(null, true);
            }

            // In production, reject unknown origins
            callback(new Error(`Not allowed by CORS: ${origin}`));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
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
