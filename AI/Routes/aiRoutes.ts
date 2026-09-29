import express from "express";
import { checkSymptoms, generatePrescription, transcribeVoicePrescription } from "../Controllers/aiController.js";

const router = express.Router();

router.post("/check-symptoms", checkSymptoms);
router.post("/prescription", generatePrescription);
router.post("/voice/transcribe", transcribeVoicePrescription);

export default router;
