import express from "express";
import {
    registerPatient,
    getPatients,
    getPatientById,
    updatePatient,
    deletePatient,
    getTodayVisits,
    getPatientVisitHistory,
    getActiveAppointments,
    getAllAppointments,
    lookupGuardianByMobile
} from "../Controllers/frontDeskController.js";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";
import { checkPortalLicense } from "../../middleware/Auth/licenseMiddleware.js";

const router = express.Router();

// All routes require Helpdesk role (except maybe viewing list if Doctor needs it, but this is Frontdesk namespace)
router.use(protect);
router.use(authorize("helpdesk", "super-admin", "hospital-admin", "hr"));
router.use(resolveTenant);
router.use(checkPortalLicense("helpdesk"));

// Patient Registration & Management
router.get("/guardians/lookup", lookupGuardianByMobile);
router.post("/patients/register", registerPatient);
router.get("/patients", getPatients);
router.get("/patients/:patientId", getPatientById);
router.put("/patients/:patientId", updatePatient);
router.delete("/patients/:patientId", deletePatient);

// Visits
router.get("/visits/today", getTodayVisits);
router.get("/visits/history/:patientId", getPatientVisitHistory);
router.get("/visits/active", getActiveAppointments);
router.get("/visits/all", getAllAppointments);

export default router;
