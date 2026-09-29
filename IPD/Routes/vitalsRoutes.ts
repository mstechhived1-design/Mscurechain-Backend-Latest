import express from "express";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import {
  getHospitalThresholds,
  saveThresholdsLegacy,
  getWardThresholds,
  listTemplates,
  createTemplate,
  getTemplateThresholds,
  saveThresholds,
  copyTemplate,
  getAdmissionThresholds,
  importThresholdsFromCSV,
  importThresholdsJSON,
  updateTemplate,
  deleteTemplate,
} from "../Controllers/vitalsThresholdController.js";
import {
  getActiveAlerts,
  updateAlertStatus,
  getPatientAlertHistory,
} from "../Controllers/vitalsAlertController.js";
import { getPatientHourlyRecord } from "../Controllers/hourlyMonitoringController.js";
import multer from "multer";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);
router.use(
  authorize(
    "hospital-admin",
    "helpdesk",
    "staff",
    "nurse",
    "doctor",
    "lab",
    "pharma-owner",
    "hr",
  ),
);

// ==================== HOURLY MONITORING ====================
router.get("/hourly-monitoring/:admissionId", getPatientHourlyRecord);

// ==================== NEW TEMPLATE SYSTEM (HIGH PRIORITY) ====================
router.post(
  "/thresholds/import",
  authorize("hospital-admin"),
  upload.single("file"),
  importThresholdsFromCSV,
);
router.post(
  "/thresholds/import-json",
  authorize("hospital-admin"),
  importThresholdsJSON,
);
router.get("/thresholds/templates", listTemplates);
router.post(
  "/thresholds/templates",
  authorize("hospital-admin"),
  createTemplate,
);
router.get("/thresholds/templates/:templateId", getTemplateThresholds);
router.post(
  "/thresholds/templates/:templateId/save",
  authorize("hospital-admin"),
  saveThresholds,
);
router.post(
  "/thresholds/templates/:templateId/copy",
  authorize("hospital-admin"),
  copyTemplate,
);
router.patch(
  "/thresholds/templates/:templateId",
  authorize("hospital-admin"),
  updateTemplate,
);
router.delete(
  "/thresholds/templates/:templateId",
  authorize("hospital-admin"),
  deleteTemplate,
);
router.get("/thresholds/admission/:admissionId", getAdmissionThresholds);

// ==================== COMPATIBILITY LAYER (LEGACY) ====================
router.get("/thresholds/:hospitalId", getHospitalThresholds);
router.get("/thresholds/:hospitalId/:wardType", getWardThresholds);
router.post("/thresholds", saveThresholdsLegacy);

// ==================== VITALS ALERTS ====================
router.get("/alerts", getActiveAlerts);
router.patch("/alerts/:alertId", updateAlertStatus);
router.get("/alerts/history/:patientId", getPatientAlertHistory);

export default router;
