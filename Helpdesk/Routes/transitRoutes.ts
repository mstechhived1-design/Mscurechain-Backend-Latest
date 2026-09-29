import express from "express";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import {
  getHospitalTransits,
  markTransitCollected,
} from "../Controllers/transitController.js";

const router = express.Router();

// Get all transits for hospital
router.get("/", protect, resolveTenant, requireTenant, getHospitalTransits);

// Mark transit as collected
router.patch(
  "/:appointmentId/collect",
  protect,
  resolveTenant,
  requireTenant,
  markTransitCollected,
);

export default router;
