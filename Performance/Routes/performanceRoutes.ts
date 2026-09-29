import express from "express";
import {
    getPerformanceDashboardV2,
    getDoctorPerformance,
    getNursePerformance,
    getStaffPerformance,
    getEmployeeTrends,
    getPerformanceWeights,
    updatePerformanceWeights,
} from "../Controllers/performanceController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import { cacheMiddleware } from "../../middleware/cache.middleware.js";

const router = express.Router();

// All performance routes require authentication + tenant resolution
router.use(protect);
router.use(resolveTenant);
router.use(authorizeRoles("hr", "hospital-admin", "super-admin"));

/**
 * @route  GET /api/performance/dashboard
 * @desc   Master dashboard — all roles combined
 * @query  month (0-indexed), year
 */
router.get("/dashboard", cacheMiddleware(5), getPerformanceDashboardV2);

/**
 * @route  GET /api/performance/doctors
 * @desc   Doctor-specific KPI performance
 * @query  month (0-indexed), year
 */
router.get("/doctors", cacheMiddleware(5), getDoctorPerformance);

/**
 * @route  GET /api/performance/nurses
 * @desc   Nurse-specific KPI performance
 * @query  month (0-indexed), year
 */
router.get("/nurses", cacheMiddleware(5), getNursePerformance);

/**
 * @route  GET /api/performance/staff
 * @desc   Staff-specific KPI performance
 * @query  month (0-indexed), year
 */
router.get("/staff", cacheMiddleware(5), getStaffPerformance);

/**
 * @route  GET /api/performance/trends/:employeeId
 * @desc   6-month trend for a single employee
 */
router.get("/trends/:employeeId", cacheMiddleware(5), getEmployeeTrends);

/**
 * @route  GET /api/performance/weights
 * @desc   View configurable KPI weights for all roles
 */
router.get("/weights", getPerformanceWeights);

/**
 * @route  PUT /api/performance/weights/:role
 * @desc   HR can update KPI weight config dynamically
 * @param  role = doctor | nurse | staff
 */
router.put("/weights/:role", updatePerformanceWeights);

export default router;
