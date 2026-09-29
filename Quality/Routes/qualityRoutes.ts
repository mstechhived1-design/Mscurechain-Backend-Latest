import express from "express";
import * as qualityController from "../Controllers/qualityController.js";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";

import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

// ✅ Protect all routes
router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);
router.use(authorize("hospital-admin", "hr"));

// Indicators
router
  .route("/indicators")
  .get(qualityController.getIndicators)
  .post(qualityController.createIndicator);

router
  .route("/indicators/:id")
  .patch(qualityController.updateIndicator)
  .delete(qualityController.deleteIndicator);

// Actions
router
  .route("/actions")
  .get(qualityController.getActions)
  .post(qualityController.createAction);

router.patch("/actions/:id/status", qualityController.updateActionStatus);
router.patch("/actions/:id/evaluate", qualityController.evaluateOutcome);

export default router;
