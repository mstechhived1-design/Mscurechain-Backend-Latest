import express from "express";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import { checkHospitalAccess } from "../../middleware/Auth/hospitalMiddleware.js";
import {
  cacheMiddleware,
  autoInvalidateCache,
} from "../../middleware/cache.middleware.js";
import {
  advancedApiGateway,
  postAuthRateLimiter,
  healthCheck,
  metricsEndpoint,
  errorRecovery,
} from "../../middleware/advancedGateway.middleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import { checkPortalLicense } from "../../middleware/Auth/licenseMiddleware.js";
import {
  getAllUsers,
  createUser,
  updateUser,
  getDashboardStats,
  getHospitalAnalytics,
  getDoctorPerformanceDetailed,
  getDoctorDetailedTransactions,
  createDoctor,
  createHelpDesk,
  assignDoctorToHospital,
  assignHelpdeskToHospital,
  removeDoctorFromHospital,
  listDoctorsByHospital,
  getHospitalWithDoctors,
  adminDashboard,
  getHospitalProfile,
  updateHospitalProfile,
  getTransactions,
  deleteUser,
  sendHelpdeskCredentials,
  getStaffById,
  getPayrollList,
  getPayrollById,
  generatePayroll,
  editTransaction,
  updatePayrollStatus,
  updatePayroll,
  getEmployeePayrollStats,
  deletePayroll,
} from "../Controllers/adminController.js";
import {
  getMonthlyReport,
  getHospitalAttendanceStats,
  getAttendanceSummary,
} from "../../Staff/Controllers/attendanceController.js";
import { getHelpDeskById } from "../../Helpdesk/Controllers/helpDeskController.js";
import { getDoctorById } from "../../Doctor/Controllers/doctorController.js";
import {
  createShift,
  getShifts,
  updateShift,
  deleteShift,
  getShiftStaff,
  assignStaffToShift,
} from "../../Staff/Controllers/shiftController.js";
import {
  getQualityMetrics,
  getQualityTrends,
  lockQualityMetrics,
} from "../../Hospital/Controllers/qualityController.js";
import {
  getEnhancedQualityMetrics,
  getIndicatorDayWiseTrends,
  getAuditTrendData,
} from "../../Hospital/Controllers/enhancedQualityController.js";
import {
  getQualityTargets,
  saveQualityTargets,
} from "../../Hospital/Controllers/qualityTargetsController.js";
import {
  createPackage,
  getPackages,
  updatePackage,
  deletePackage,
  togglePackageStatus
} from "../Controllers/hospitalPackageController.js";
import {
  getCharges,
  createCharge,
  updateCharge,
  deleteCharge,
  resetCharges
} from "../Controllers/hospitalChargeController.js";


const router = express.Router();

// ✅ ADVANCED API GATEWAY: Apply production-grade security, monitoring and rate limiting
router.use(advancedApiGateway);
router.use(autoInvalidateCache);

// ✅ SYSTEM MONITORING: Health & Performance Metrics
router.get("/health", healthCheck);
router.get("/metrics", metricsEndpoint);

// Middleware: All routes here require hospital-admin, super-admin, admin, doctor, helpdesk, or nurse.
// Most routes are for viewing, modification is restricted below.
router.use(protect);
// ✅ FIX: postAuthRateLimiter runs AFTER protect() so req.user is populated.
// This prevents all concurrent dashboard requests from sharing the same
// anonymous IP-based Redis key and hitting the 429 rate limit.
router.use(postAuthRateLimiter);
router.use(
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "admin",
    "doctor",
    "helpdesk",
    "masterhelpdesk",
    "nurse",
    "hr",
    "pharma-owner", // allow pharmacy to read nurses list
  ),
);

// ✅ MULTI-TENANCY: Resolve and Require Tenant Context
router.use(resolveTenant);
router.use(requireTenant);
router.use(checkPortalLicense("hospitalAdmin"));

// ✅ SCALABLE PERFORMANCE: Optimized Caching Strategies
// Dashboard & Stats with hyper-dynamic TTL (10-30s)
router.get(
  "/dashboard",
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "admin",
    "doctor",
    "hr",
    "nurse",
    "helpdesk",
    "masterhelpdesk",
  ),
  cacheMiddleware(10),
  adminDashboard,
);
router.get(
  "/stats",
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "admin",
    "doctor",
    "hr",
    "nurse",
    "helpdesk",
    "masterhelpdesk",
  ),
  cacheMiddleware(10),
  getDashboardStats,
);
router.get(
  "/analytics",
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "admin",
    "doctor",
    "hr",
    "nurse",
    "helpdesk",
    "masterhelpdesk",
  ),
  cacheMiddleware(30),
  getHospitalAnalytics,
);
router.get(
  "/analytics/doctor-performance",
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "admin",
    "doctor",
    "hr",
    "nurse",
    "helpdesk",
    "masterhelpdesk",
  ),
  cacheMiddleware(30),
  getDoctorPerformanceDetailed,
);
router.get(
  "/analytics/doctor-performance/:id/details",
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "admin",
    "doctor",
    "hr",
    "nurse",
    "helpdesk",
    "masterhelpdesk",
  ),
  getDoctorDetailedTransactions,
);

import upload from "../../middleware/Upload/upload.js";

router.get(
  "/hospital",
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "admin",
    "patient",
    "doctor",
    "nurse",
    "helpdesk",
    "masterhelpdesk",
    "hr",
    "pharma-owner",
  ),
  cacheMiddleware(300),
  getHospitalProfile,
); // 5 min - Hospital data changes infrequently
router.put(
  "/hospital",
  authorizeRoles("hospital-admin", "super-admin", "admin", "masterhelpdesk"),
  upload.single("logo"),
  updateHospitalProfile,
);
router.patch(
  "/hospital",
  authorizeRoles("hospital-admin", "super-admin", "admin", "masterhelpdesk"),
  upload.single("logo"),
  updateHospitalProfile,
);
router.get("/transactions", cacheMiddleware(60), getTransactions); // 1 min (high frequency)
router.patch("/transactions/:id/edit", authorizeRoles("hospital-admin", "super-admin", "admin", "masterhelpdesk"), editTransaction);

// ✅ RESOURCE MANAGEMENT: With Invalidation Hooks
router.get(
  "/doctors",
  (req: any, res, next) => {
    req.filterRole = "doctor";
    next();
  },
  cacheMiddleware(30),
  getAllUsers,
);
router.post(
  "/doctors",
  (req, res, next) => {
    req.body.role = "doctor";
    next();
  },
  createUser,
);
router.post("/create-doctor", createDoctor);
router.get("/doctors/:id", cacheMiddleware(60), getDoctorById);
router.put(
  "/doctors/:id",
  (req, res, next) => {
    req.body.role = "doctor";
    next();
  },
  updateUser,
);
router.delete("/doctors/:id", deleteUser);
router.post("/assign-doctor", assignDoctorToHospital);
router.post("/assign-helpdesk", assignHelpdeskToHospital);
router.delete("/remove-doctor", removeDoctorFromHospital);
router.get("/hospitals/:id/doctors", listDoctorsByHospital);
router.get("/hospitals/:id/details", getHospitalWithDoctors);


router.get(
  "/helpdesks",
  (req: any, res, next) => {
    req.filterRole = "helpdesk";
    next();
  },
  cacheMiddleware(30),
  getAllUsers,
);
router.post(
  "/helpdesks",
  (req, res, next) => {
    req.body.role = "helpdesk";
    next();
  },
  createUser,
);
router.post("/create-helpdesk", createHelpDesk);
router.get("/helpdesks/:id", cacheMiddleware(60), getHelpDeskById);
router.put(
  "/helpdesks/:id",
  (req, res, next) => {
    req.body.role = "helpdesk";
    next();
  },
  updateUser,
);
router.delete("/helpdesks/:id", deleteUser);
router.post("/helpdesks/send-credentials", sendHelpdeskCredentials);

router.get(
  "/patients",
  (req: any, res, next) => {
    req.filterRole = "patient";
    next();
  },
  cacheMiddleware(30),
  getAllUsers,
);
router.get(
  "/pharma",
  (req: any, res, next) => {
    req.filterRole = "pharma-owner";
    next();
  },
  cacheMiddleware(60),
  getAllUsers,
);
router.get(
  "/labs",
  (req: any, res, next) => {
    req.filterRole = "lab";
    next();
  },
  cacheMiddleware(60),
  getAllUsers,
);

router.get(
  "/staff",
  (req: any, res, next) => {
    req.filterRole = "staff";
    next();
  },
  cacheMiddleware(30),
  getAllUsers,
);
router.post(
  "/staff",
  (req, res, next) => {
    req.body.role = "staff";
    next();
  },
  createUser,
);
router.get("/staff/:id", cacheMiddleware(60), getStaffById);
router.put(
  "/staff/:id",
  (req, res, next) => {
    req.body.role = "staff";
    next();
  },
  updateUser,
);
router.delete("/staff/:id", deleteUser);

router.get(
  "/nurses",
  (req: any, res, next) => {
    req.filterRole = "nurse";
    next();
  },
  cacheMiddleware(30),
  getAllUsers,
);
router.post(
  "/nurses",
  (req, res, next) => {
    req.body.role = "nurse";
    next();
  },
  createUser,
);
router.put(
  "/nurses/:id",
  (req, res, next) => {
    req.body.role = "nurse";
    next();
  },
  updateUser,
);
router.delete("/nurses/:id", deleteUser);

router.get(
  "/hrs",
  (req: any, res, next) => {
    req.filterRole = "hr";
    next();
  },
  cacheMiddleware(30),
  getAllUsers,
);
router.post(
  "/hrs",
  (req, res, next) => {
    req.body.role = "hr";
    next();
  },
  createUser,
);
router.put(
  "/hrs/:id",
  (req, res, next) => {
    req.body.role = "hr";
    next();
  },
  updateUser,
);
router.delete("/hrs/:id", deleteUser);

// ✅ COMPLEX MONITORING: Aggregated Reports
router.get(
  "/attendance",
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "admin",
    "helpdesk",
    "masterhelpdesk",
    "doctor",
    "hr",
    "nurse",
  ),
  cacheMiddleware(30),
  getMonthlyReport,
);
router.get(
  "/attendance/report",
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "admin",
    "helpdesk",
    "masterhelpdesk",
    "doctor",
    "hr",
    "nurse",
  ),
  cacheMiddleware(30),
  getHospitalAttendanceStats,
);
router.get(
  "/attendance/summary",
  authorizeRoles(
    "hospital-admin",
    "super-admin",
    "admin",
    "helpdesk",
    "masterhelpdesk",
    "doctor",
    "hr",
    "nurse",
  ),
  cacheMiddleware(30),
  getAttendanceSummary,
);

// ✅ OPERATIONAL SYSTEMS: Real-time Shift Mgmt
router.get("/shifts", cacheMiddleware(30), getShifts);
router.post("/shifts", createShift);
router.put("/shifts/:id", updateShift);
router.delete("/shifts/:id", deleteShift);
router.get("/shifts/:id/staff", cacheMiddleware(30), getShiftStaff);
router.post("/shifts/:id/assign", assignStaffToShift);

// ✅ HOSPITAL PACKAGES
router.post("/packages", createPackage);
router.get("/packages", getPackages);
router.put("/packages/:id", updatePackage);
router.delete("/packages/:id", deletePackage);
router.patch("/packages/:id/status", togglePackageStatus);

// ✅ HOSPITAL CHARGES (IPD CATEGORIES)
router.get("/charges", getCharges);
router.post("/charges", createCharge);
router.put("/charges/:id", updateCharge);
router.delete("/charges/:id", deleteCharge);
router.post("/charges/reset", resetCharges);


// ✅ FINANCIAL SYSTEMS: Payroll & Payslips
router.get("/payroll", getPayrollList);
router.get("/payroll/employee-stats", getEmployeePayrollStats);
router.get("/payroll/:id", getPayrollById);
router.post("/payroll/generate", generatePayroll);
router.patch("/payroll/:id/status", updatePayrollStatus);
router.put("/payroll/:id", updatePayroll);
router.delete("/payroll/:id", deletePayroll);

// ✅ QUALITY SYSTEMS: NABH Quality Indicators
router.get("/quality-metrics", getQualityMetrics);
router.get("/enhanced-quality-metrics", getEnhancedQualityMetrics);
router.get("/quality-metrics/trends", getQualityTrends);
router.get("/quality-metrics/day-wise", getIndicatorDayWiseTrends);
router.get("/quality-metrics/audit-trends", getAuditTrendData);
router.post("/quality-metrics/lock", lockQualityMetrics);
router.get("/quality-metrics/targets", getQualityTargets);
router.put("/quality-metrics/targets", saveQualityTargets);

// ✅ LEGACY SUPPORT: Backward compatibility
router.get("/users", getAllUsers);
router.post("/users", createUser);
router.put("/users/:id", updateUser);
router.delete("/users/:id", deleteUser);

// ✅ ERROR RECOVERY: Advanced Gateway Error handling
router.use(errorRecovery);

export default router;
