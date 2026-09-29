import express from "express";
import {
  getHRStats,
  getAllStaff,
  createStaff,
  getStaffDetails,
  getStaffLeaves,
  updateLeaveStatus,
  getStaffAttendance,
  getHRRecruitment,
  getHRPerformance,
  submitHRPerformance,
  getHRDocuments,
  getHRTraining,
  getPerformanceDashboard,
  getDoctorPerformanceDashboard,
  uploadHRDocument,
  deleteHRDocument,
} from "../Controllers/hrController.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

// Using authMiddleware
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";
import { checkPortalLicense } from "../../middleware/Auth/licenseMiddleware.js";

import {
  cacheMiddleware,
  autoInvalidateCache,
} from "../../middleware/cache.middleware.js";
import { advancedApiGateway } from "../../middleware/advancedGateway.middleware.js";

// Payroll controllers + updateUser (same as hospital admin)
import {
  getPayrollList,
  getPayrollById,
  generatePayroll,
  updatePayrollStatus,
  updatePayroll,
  deletePayroll,
  getEmployeePayrollStats,
  updateUser,
} from "../../Admin/Controllers/adminController.js";

const router = express.Router();

router.use(advancedApiGateway);
router.use(autoInvalidateCache);

// All HR routes require HR role and tenant resolution
router.use(protect);
router.use(resolveTenant);
router.use(checkPortalLicense("hr"));
router.use(authorizeRoles("hr", "hospital-admin", "super-admin"));

router.get("/stats", cacheMiddleware(30), getHRStats);
router.get("/staff", cacheMiddleware(60), getAllStaff);
router.get("/staff/:id", cacheMiddleware(30), getStaffDetails);
router.post("/staff", createStaff);
router.put("/staff/:id", updateUser);

// Leave management
router.get("/leaves", getStaffLeaves);
router.patch("/leaves/:id", updateLeaveStatus);

// Attendance management
router.get("/attendance", getStaffAttendance);

// Payroll management (same controllers as hospital admin)
router.get("/payroll", getPayrollList);
router.get("/payroll/employee-stats", getEmployeePayrollStats);
router.get("/payroll/:id", getPayrollById);
router.post("/payroll/generate", generatePayroll);
router.patch("/payroll/:id/status", updatePayrollStatus);
router.put("/payroll/:id", updatePayroll);
router.delete("/payroll/:id", deletePayroll);

// New features
router.get("/recruitment", getHRRecruitment);
router.get("/performance", getHRPerformance);
router.get("/dashboard/performance", getPerformanceDashboard); // Enhanced performance dashboard
router.get("/dashboard/doctor-performance", getDoctorPerformanceDashboard); // Doctor-specific performance
router.post("/performance", submitHRPerformance);
router.get("/documents", getHRDocuments);
router.post("/documents/upload", upload.single("document"), uploadHRDocument);
router.delete("/documents", deleteHRDocument);
router.get("/training", getHRTraining);

export default router;
