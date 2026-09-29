import express from "express";
import {
    registerPatient,
    getMasterDashboard,
    getMasterQueue,
    getMasterTransactions,
    getMasterPatients,
    getPatientById,
    updatePatient,
    deletePatient,
    getTodayVisits,
    getPatientVisitHistory,
    getActiveAppointments,
    getAllAppointments,
    getPatientIPDAdmissions,
    getMasterHelpdeskMe,
    updateMasterHelpdeskProfile,
    deleteMasterAppointment
} from "../Controllers/masterHelpdeskController.js";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";
import { checkPortalLicense } from "../../middleware/Auth/licenseMiddleware.js";

const router = express.Router();

// Master Helpdesk requires 'masterhelpdesk' role or higher
router.use(protect);
router.use(authorize("masterhelpdesk", "super-admin", "hospital-admin"));
router.use(resolveTenant); // Master views are often cross-tenant, but keep for user info
router.use(checkPortalLicense("masterhelpdesk")); // Check masterhelpdesk portal license

// Core Master Dashboard
router.get("/dashboard", getMasterDashboard);
router.get("/queue", getMasterQueue);
router.get("/transactions", getMasterTransactions);

// Profile Management
router.get("/me", getMasterHelpdeskMe);
router.put("/me", updateMasterHelpdeskProfile);

// Patient Registration & Management
router.post("/patients/register", registerPatient);
router.get("/patients", getMasterPatients);
router.get("/patients/:patientId", getPatientById);
router.put("/patients/:patientId", updatePatient);
router.delete("/patients/:patientId", deletePatient);

// Visits
router.get("/visits/today", getTodayVisits);
router.get("/visits/history/:patientId", getPatientVisitHistory);
router.get("/visits/active", getActiveAppointments);
router.get("/visits/all", getAllAppointments);

// IPD Admissions
router.get("/patients/:patientId/ipd-admissions", getPatientIPDAdmissions);

// Appointments
import { updateAppointmentStatus } from "../../Appointment/Controllers/bookingController.js";
router.patch("/appointments/:id/status", updateAppointmentStatus);
router.delete("/appointments/:id", deleteMasterAppointment);

export default router;
