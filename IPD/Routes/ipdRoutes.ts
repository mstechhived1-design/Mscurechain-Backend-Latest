import express from "express";
import {
  initiateAdmission,
  transferBed,
  dischargePatient,
  getActiveAdmissions,
  requestDischarge,
  requestTransfer,
  getPendingRequests,
  cancelDischargeRequest,
  cancelTransferRequest,
  updateAdmissionDetails,
  getDischargedAdmissions,
} from "../Controllers/ipdController.js";
import { confirmDischarge } from "../Controllers/confirmDischargeController.js";
import { getAdmissionDetailsForDischarge } from "../Controllers/getAdmissionDetailsController.js";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import {
  logVitals,
  addClinicalNote,
  administerMedication,
  deleteMedicationRecord,
  logDiet,
  deleteDietRecord,
  getPatientClinicalHistory,
  getPrescriptionsByAdmissionId,
  getLabReportsByAdmissionId,
} from "../Controllers/nurseController.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);
router.use(
  authorize(
    "hospital-admin",
    "super-admin",
    "masterhelpdesk",
    "helpdesk",
    "staff",
    "nurse",
    "doctor",
    "lab",
    "pharma-owner",
    "hr",
  ),
);

router.get("/active", getActiveAdmissions);
router.get("/discharged", getDischargedAdmissions);
router.get("/pending-requests", getPendingRequests); // SPECIFIC FIRST
router.get("/:admissionId/clinical-history", getPatientClinicalHistory);
router.get("/:admissionId/prescriptions", getPrescriptionsByAdmissionId);
router.get("/:admissionId/lab-reports", getLabReportsByAdmissionId);
router.get("/:admissionId", getAdmissionDetailsForDischarge); // GREEDY LAST

router.post("/", initiateAdmission);
router.post("/:id/transfer", transferBed);
router.post("/:id/discharge", dischargePatient);
router.post("/:id/request-discharge", requestDischarge);
router.post("/:id/request-transfer", requestTransfer);
router.post("/:id/cancel-discharge", cancelDischargeRequest);
router.post("/:id/cancel-transfer", cancelTransferRequest);
router.patch("/:id", updateAdmissionDetails);
router.post("/:admissionId/confirm-discharge", confirmDischarge);

// Nurse Specific Records
router.post("/log-vitals", logVitals);
router.post("/add-note", addClinicalNote);
router.post("/administer-med", administerMedication);
router.delete("/administer-med/:recordId", deleteMedicationRecord);
router.post("/log-diet", logDiet);
router.delete("/delete-diet/:recordId", deleteDietRecord);

export default router;
