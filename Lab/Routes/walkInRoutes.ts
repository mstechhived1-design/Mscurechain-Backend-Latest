import express from "express";
import {
  registerWalkInPatient,
  createDirectLabOrder,
  processPayment,
  collectSample,
  enterResults,
  getDirectLabOrders,
  getDirectLabOrder,
  searchWalkInPatients,
} from "../Controllers/walkInController.js";
import {
  generateWalkInLabReport,
  generateWalkInReportWithBilling,
} from "../Controllers/reportController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";

import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

// Walk-in Patient Management
router.post(
  "/register",
  authorizeRoles("lab", "hospital-admin"),
  registerWalkInPatient,
);
router.get(
  "/patients/search",
  authorizeRoles("lab", "hospital-admin"),
  searchWalkInPatients,
);

// Direct Lab Order Management
router.post(
  "/orders",
  authorizeRoles("lab", "hospital-admin"),
  createDirectLabOrder,
);
router.get(
  "/orders",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  getDirectLabOrders,
);
router.get(
  "/orders/:orderId",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  getDirectLabOrder,
);

// Report Generation
router.get(
  "/reports/:orderId",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  generateWalkInLabReport,
);
router.get(
  "/reports/:orderId/with-billing",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  generateWalkInReportWithBilling,
);

// Order Workflow
router.post(
  "/orders/:orderId/pay",
  authorizeRoles("lab", "hospital-admin"),
  processPayment,
);
router.put(
  "/orders/:orderId/collect-sample",
  authorizeRoles("lab"),
  collectSample,
);
router.put("/orders/:orderId/results", authorizeRoles("lab"), enterResults);

export default router;
