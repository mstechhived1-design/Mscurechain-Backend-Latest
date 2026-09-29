import express from "express";
import {
  getDoctorProfile,
  getDoctorDashboard,
  updateDoctorProfile,
  searchDoctors,
  getDoctorById,
  getPatientDetails,
  uploadPhoto,
  startNextAppointment,
  getDoctorCalendarStats,
  getDoctorAppointmentsByDate,
  addQuickNote,
  getQuickNotes,
  getDoctorPatients,
  getDoctorAnalytics,
  deleteQuickNote,
  getDoctorIncomeStats,
  getPatientHistory,
  updateDoctorStatus,
} from "../Controllers/doctorController.js";

import {
  getDoctorTemplates,
  createDoctorTemplate,
  deleteDoctorTemplate,
} from "../Controllers/templateController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import upload from "../../middleware/Upload/upload.js";
import { checkPortalLicense } from "../../middleware/Auth/licenseMiddleware.js";

const router = express.Router();

// Protected Routes Stack
router.use(protect);
router.use(resolveTenant);
router.use(checkPortalLicense("doctor"));

// Doctor Profile
router.get(
  "/me",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
    "masterhelpdesk",
  ),
  getDoctorProfile,
);
router.get(
  "/profile/me",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
    "masterhelpdesk",
  ),
  getDoctorProfile,
);
router.put(
  "/me",
  authorizeRoles("doctor", "hospital-admin", "super-admin", "masterhelpdesk"),
  upload.any(),
  resolveTenant, // Restore AsyncLocalStorage context lost during multer parsing
  updateDoctorProfile,
);

router.post(
  "/upload-photo",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
    "masterhelpdesk",
  ),
  upload.single("profilePic"),
  resolveTenant,
  uploadPhoto,
);

// Support frontend profile update action
router.patch(
  "/me/photo",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
    "masterhelpdesk",
  ),
  upload.single("profilePic"),
  resolveTenant,
  uploadPhoto,
);

router.patch(
  "/status",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
    "masterhelpdesk",
  ),
  updateDoctorStatus,
);

// Helper / Catch-all routes (Moved above requireTenant to allow global doctor search)
router.get("/", searchDoctors);

// Explicit Tenant Required for below
router.use(requireTenant);

// Dashboard & Analytics
router.get(
  "/dashboard",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "nurse",
    "lab",
    "pharma-owner",
    "masterhelpdesk",
  ),
  getDoctorDashboard,
);
router.get(
  "/analytics",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "nurse",
    "lab",
    "pharma-owner",
    "helpdesk",
    "masterhelpdesk",
  ),
  getDoctorAnalytics,
);

// Clinical Actions
router.post("/start-next", authorizeRoles("doctor"), startNextAppointment);
router.get(
  "/my-patients",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "nurse",
    "lab",
    "pharma-owner",
    "helpdesk", // Allow helpdesk to view the patients list (prevents intermittent 403 errors)
  ),
  getDoctorPatients,
);
router.get(
  "/patient/:patientId",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "nurse",
    "lab",
    "pharma-owner",
    "helpdesk", // Allow helpdesk to view patient details (prevents intermittent 403 errors)
  ),
  getPatientDetails,
);
router.get(
  "/patient/:patientId/history",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "nurse",
    "lab",
    "pharma-owner",
    "helpdesk",
    "masterhelpdesk",
  ),
  getPatientHistory,
);

// Calendar
router.get(
  "/calendar/stats",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
    "masterhelpdesk",
  ),
  getDoctorCalendarStats,
);
router.get(
  "/calendar/appointments",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "nurse",
    "masterhelpdesk",
  ),
  getDoctorAppointmentsByDate,
);

// Quick Notes
router.post(
  "/quick-notes",
  authorizeRoles("doctor", "nurse", "helpdesk", "hospital-admin", "super-admin", "masterhelpdesk"),
  addQuickNote,
);
router.get(
  "/quick-notes",
  authorizeRoles("doctor", "nurse", "helpdesk", "hospital-admin", "super-admin", "masterhelpdesk"),
  getQuickNotes,
);
router.delete(
  "/quick-notes/:id",
  authorizeRoles("doctor", "nurse", "helpdesk", "hospital-admin", "super-admin", "masterhelpdesk"),
  deleteQuickNote,
);

// Templates
router.get("/templates", authorizeRoles("doctor"), getDoctorTemplates);
router.post("/templates", authorizeRoles("doctor"), createDoctorTemplate);
router.delete("/templates/:id", authorizeRoles("doctor"), deleteDoctorTemplate);

// Income & Custom Stats
router.get(
  "/income-stats",
  authorizeRoles("doctor", "helpdesk", "hospital-admin", "super-admin", "masterhelpdesk"),
  getDoctorIncomeStats,
);

// Catch-all parametric route (MUST BE LAST to avoid shadowing literal routes)
router.get("/:id", getDoctorById);

export default router;
