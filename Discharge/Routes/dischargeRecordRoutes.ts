import express from "express";
import { dischargeRecordController } from "../Controllers/dischargeRecordController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import { cacheMiddleware } from "../../middleware/cache.middleware.js";
import { checkPortalLicense } from "../../middleware/Auth/licenseMiddleware.js";

const router = express.Router();

// All records routes are protected + tenant resolved
router.use(protect);
router.use(resolveTenant);
router.use(checkPortalLicense("discharge"));

// Patient discharge records (for patient portal) (No tenant required)
router.get(
  "/patient/records",
  cacheMiddleware(60),
  dischargeRecordController.getPatientDischargeRecords,
);

// Patient specific route (verify match) (No tenant required)
router.get(
  "/patient-view/:identifier",
  dischargeRecordController.getPatientSummary,
);

// Auto-fill route
router.get(
  "/admission-details/:id",
  dischargeRecordController.getAdmissionData,
);

// Require tenant for all other hospital-specific routes
router.use(requireTenant);

router.get(
  "/dashboard/stats",
  requireTenant,
  cacheMiddleware(30),
  dischargeRecordController.getStats,
);
router.get(
  "/pending",
  requireTenant,
  cacheMiddleware(10),
  dischargeRecordController.getPendingDischarges,
); // 10s cache for dynamic queue

router.get("/", requireTenant, cacheMiddleware(30), dischargeRecordController.getHistory);
router.post("/", requireTenant, dischargeRecordController.saveRecord);

// Single record operations
router.get("/:id", requireTenant, dischargeRecordController.getRecordById);
router.patch("/:id", requireTenant, dischargeRecordController.updateRecord);
router.delete("/:id", requireTenant, dischargeRecordController.deleteRecord);

// ⚠️ Static sub-paths MUST come before /:id to avoid Express matching "patient" as an id param

export default router;