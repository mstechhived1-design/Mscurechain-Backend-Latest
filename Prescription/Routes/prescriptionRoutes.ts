import express from "express";
import {
  createPrescription,
  getPrescriptions,
  getPrescriptionById,
  deletePrescription,
  deletePrescriptions,
  getDermatologyByPrescriptionId,
  getCardiologyByPrescriptionId,
  getENTByPrescriptionId,
  getPedsByPrescriptionId,
  getGynecologyByPrescriptionId,
  getNeuroByPrescriptionId,
  getGastroByPrescriptionId,
  getNephroByPrescriptionId,
  getOphthaByPrescriptionId,
  getOrthoByPrescriptionId,
  getPulmoByPrescriptionId,
  getPsychByPrescriptionId,
  getEndoByPrescriptionId,
  getHemaByPrescriptionId,
  getOncoByPrescriptionId,
  getDentistryByPrescriptionId,
  getUrologyByPrescriptionId,
  getRadiologyByPrescriptionId,
  createRadiologyReport,
} from "../Controllers/prescriptionController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

router.post("/", createPrescription);
router.get("/", getPrescriptions);
router.get("/:id", getPrescriptionById);
router.get("/:prescriptionId/dermatology", getDermatologyByPrescriptionId);
router.get("/:prescriptionId/cardiology", getCardiologyByPrescriptionId);
router.get("/:prescriptionId/ent", getENTByPrescriptionId);
router.get("/:prescriptionId/pediatrics", getPedsByPrescriptionId);
router.get("/:prescriptionId/gynecology", getGynecologyByPrescriptionId);
router.get("/:prescriptionId/neurology", getNeuroByPrescriptionId);
router.get("/:prescriptionId/gastroenterology", getGastroByPrescriptionId);
router.get("/:prescriptionId/nephrology", getNephroByPrescriptionId);
router.get("/:prescriptionId/ophthalmology", getOphthaByPrescriptionId);
router.get("/:prescriptionId/orthopedics", getOrthoByPrescriptionId);
router.get("/:prescriptionId/pulmonology", getPulmoByPrescriptionId);
router.get("/:prescriptionId/psychiatry", getPsychByPrescriptionId);
router.get("/:prescriptionId/endocrinology", getEndoByPrescriptionId);
router.get("/:prescriptionId/hematology", getHemaByPrescriptionId);
router.get("/:prescriptionId/oncology", getOncoByPrescriptionId);
router.get("/:prescriptionId/dentistry", getDentistryByPrescriptionId);
router.get("/:prescriptionId/urology", getUrologyByPrescriptionId);
router.get("/:prescriptionId/radiology", getRadiologyByPrescriptionId);
router.post("/radiology/reports/:orderId", createRadiologyReport);
router.post("/delete-batch", deletePrescriptions);
router.delete("/:id", deletePrescription);

export default router;
