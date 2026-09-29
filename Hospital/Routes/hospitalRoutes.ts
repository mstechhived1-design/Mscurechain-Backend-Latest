import express from "express";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import upload from "../../middleware/Upload/upload.js";
import {
  createHospital,
  listHospitals,
  getHospital,
  patchHospital,
  addBranch,
  listBranches,
  deleteHospital,
  getHospitalMetadata,
  updateBillingCategories,
  updateClinicalNoteMetadata,
  updateIPDPharmaSettings,
  getInfrastructureReadiness,
} from "../Controllers/hospitalController.js";

import {
  getReminderConfig,
  updateReminderConfig,
} from "../Controllers/reminderConfigController.js";

const router = express.Router();

router.post("/", protect, authorizeRoles("super-admin"), createHospital);
router.get("/", listHospitals);
router.get(
  "/metadata",
  protect,
  resolveTenant,
  requireTenant,
  authorizeRoles(
    "hospital-admin",
    "admin",
    "staff",
    "doctor",
    "nurse",
    "helpdesk",
    "pharma-owner",
    "hr",
    "super-admin",
    "patient",
  ),
  getHospitalMetadata,
);
router.get(
  "/readiness",
  protect,
  resolveTenant,
  requireTenant,
  authorizeRoles(
    "hospital-admin",
    "admin",
    "hr",
    "super-admin",
    "helpdesk",
    "nurse",
    "doctor",
  ),
  getInfrastructureReadiness,
);
router.patch(
  "/billing-categories",
  protect,
  resolveTenant,
  requireTenant,
  authorizeRoles("hospital-admin", "admin", "doctor", "super-admin"),
  updateBillingCategories,
);
router.patch(
  "/clinical-notes-metadata",
  protect,
  resolveTenant,
  requireTenant,
  authorizeRoles("hospital-admin", "admin", "doctor", "super-admin"),
  updateClinicalNoteMetadata,
);
router.patch(
  "/ipd-pharma-settings",
  protect,
  resolveTenant,
  requireTenant,
  authorizeRoles(
    "hospital-admin",
    "admin",
    "doctor",
    "pharma-owner",
    "super-admin",
  ),
  updateIPDPharmaSettings,
);

// Reminder Configuration
router.get(
  "/reminders/config",
  protect,
  resolveTenant,
  requireTenant,
  authorizeRoles("hospital-admin", "admin", "super-admin"),
  getReminderConfig,
);
router.patch(
  "/reminders/config",
  protect,
  resolveTenant,
  requireTenant,
  authorizeRoles("hospital-admin", "admin", "super-admin"),
  updateReminderConfig,
);

// ... existing imports

router.get("/:id", getHospital);
router.patch(
  "/:id",
  protect,
  authorizeRoles("super-admin", "hospital-admin"),
  patchHospital,
);

router.post(
  "/:id/branches",
  protect,
  authorizeRoles("super-admin", "hospital-admin"),
  addBranch,
);
router.get("/:id/branches", listBranches);
router.delete(
  "/:id",
  protect,
  authorizeRoles("super-admin", "hospital-admin"),
  deleteHospital,
);

export default router;
