import express from "express";
import {
  getProfile,
  updateProfile,
  getPatientProfileById,
  searchPatients,
  getPatientWithBedInfo,
  deleteAccount,
} from "../Controllers/patientController.js";
import {
  getPatientAppointments,
  getPatientPrescriptions,
  getPatientLabRecords,
  getPatientHelpdeskPrescriptions,
  getPatientDashboardData,
  getPatientHospitals,
  scanQRCode,
} from "../Controllers/patientDataController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import { cacheMiddleware } from "../../middleware/cache.middleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);

// Profile routes
router.get(
  "/profile",
  authorizeRoles("patient", "super-admin", "hospital-admin"),
  getProfile,
);
router.get(
  "/profile/:id",
  authorizeRoles("doctor", "super-admin", "hospital-admin"),
  getPatientProfileById,
);
router.patch(
  "/profile",
  authorizeRoles("patient", "super-admin", "hospital-admin"),
  updateProfile,
);
router.delete(
  "/profile",
  authorizeRoles("patient"),
  deleteAccount,
);

// Patient search and bed info routes (Isolated to hospital)
router.get(
  "/search",
  requireTenant,
  authorizeRoles("doctor", "nurse", "staff", "hospital-admin", "lab", "pharma-owner"),
  searchPatients,
);
router.get(
  "/:patientId/bed-info",
  requireTenant,
  authorizeRoles("doctor", "nurse", "staff", "hospital-admin"),
  getPatientWithBedInfo,
);

// Patient data routes
router.get(
  "/hospitals",
  authorizeRoles("patient", "doctor", "nurse", "staff"),
  getPatientHospitals,
);

router.get(
  "/appointments",
  authorizeRoles("patient", "doctor", "nurse", "staff"),
  getPatientAppointments,
);
router.get(
  "/prescriptions",
  authorizeRoles("patient", "doctor", "nurse", "staff"),
  getPatientPrescriptions,
);
router.get(
  "/lab-records",
  authorizeRoles("patient", "doctor", "nurse", "staff"),
  getPatientLabRecords,
);
router.get(
  "/helpdesk-prescriptions",
  authorizeRoles("patient", "doctor", "nurse", "staff"),
  getPatientHelpdeskPrescriptions,
);
router.get(
  "/dashboard-data",
  authorizeRoles("patient", "doctor", "nurse", "staff"),
  // cacheMiddleware(30),
  getPatientDashboardData,
);

router.post(
  "/scan-qr",
  authorizeRoles("patient"),
  upload.single("image"),
  scanQRCode,
);

export default router;
