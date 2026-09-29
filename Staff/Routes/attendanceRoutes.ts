// @ts-ignore
import express from "express";
import {
  checkIn,
  checkOut,
  getMonthlyReport,
  getSelfAttendance,
  getTodayAttendance,
  getStaffDashboard,
  getSelfPayroll,
  getStaffSchedule,
  getStaffProfile,
  updateStaffProfile,
  getAttendanceSummary
} from "../Controllers/attendanceController.js";
import { uploadStaffDocument } from "../Controllers/staffDocumentController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import { checkPortalLicense } from "../../middleware/Auth/licenseMiddleware.js";

import { cacheMiddleware, autoInvalidateCache } from "../../middleware/cache.middleware.js";
// @ts-ignore
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// Middleware: All routes here require protection
router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);
router.use(checkPortalLicense("staff"));

router.post(
  "/check-in",
  authorizeRoles(
    "staff",
    "doctor",
    "nurse",
    "helpdesk",
    "hospital-admin",
    "super-admin",
    "emergency",
  ),
  checkIn,
);

router.post(
  "/check-out",
  authorizeRoles(
    "staff",
    "doctor",
    "nurse",
    "helpdesk",
    "hospital-admin",
    "super-admin",
    "emergency",
  ),
  checkOut,
);

router.get(
  "/me",
  authorizeRoles(
    "staff",
    "doctor",
    "nurse",
    "helpdesk",
    "hospital-admin",
    "super-admin",
    "emergency",
  ),
  getSelfAttendance,
);

router.get(
  "/dashboard",
  authorizeRoles(
    "staff",
    "doctor",
    "nurse",
    "helpdesk",
    "hospital-admin",
    "super-admin",
    "emergency",
  ),
  getStaffDashboard,
);

router.get(
  "/today-status",
  authorizeRoles(
    "staff",
    "doctor",
    "nurse",
    "helpdesk",
    "hospital-admin",
    "super-admin",
    "emergency",
  ),
  getTodayAttendance,
);

router.get(
  "/self-payroll",
  authorizeRoles("staff", "nurse", "helpdesk", "emergency"),
  getSelfPayroll,
);

router.get(
  "/schedule",
  authorizeRoles(
    "staff",
    "doctor",
    "nurse",
    "helpdesk",
    "hospital-admin",
    "super-admin",
    "emergency",
  ),
  getStaffSchedule,
);

router.get(
  "/profile",
  authorizeRoles(
    "staff",
    "doctor",
    "nurse",
    "helpdesk",
    "hospital-admin",
    "super-admin",
    "admin",
    "emergency",
  ),
  cacheMiddleware(60, "staff:profile"), // 60s cache
  getStaffProfile,
);

// ✅ Robust Profile Update with Fuzzy Field Handling
router.patch(
  "/profile",
  protect,
  resolveTenant,
  authorizeRoles(
    "staff",
    "doctor",
    "nurse",
    "helpdesk",
    "hospital-admin",
    "super-admin",
    "admin",
    "emergency",
  ),
  autoInvalidateCache,
  upload.any(),
  updateStaffProfile as any,
);

// Summary path for HR/Admins
router.get(
  "/summary",
  authorizeRoles("hospital-admin", "super-admin", "admin", "hr"),
  getAttendanceSummary
);

// Upload document endpoint for staff/nurses
router.post(
  "/upload-document",
  authorizeRoles("staff", "nurse", "emergency"),
  upload.single("document"),
  uploadStaffDocument,
);

router.get(
  "/report",
  authorizeRoles("hospital-admin", "super-admin", "admin"),
  getMonthlyReport,
);

export default router;
