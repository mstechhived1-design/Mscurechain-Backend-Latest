import express from "express";
import { body } from "express-validator";
import * as emergencyRequestController from "../Controllers/emergencyRequestController.js";
import { authenticateEmergencyPersonnel } from "../../middleware/emergencyAuth.js";
import { protect as authenticate } from "../../middleware/Auth/authMiddleware.js";
import tenantMiddleware from "../../middleware/tenantMiddleware.js";
const { resolveTenant, requireTenant } = tenantMiddleware;

const router = express.Router();

// @route   POST /api/emergency/requests
// @desc    Create emergency request
// @access  Private (Ambulance Personnel)
router.post(
  "/",
  authenticateEmergencyPersonnel,
  [
    body("patientName").notEmpty().withMessage("Patient name required"),
    body("patientAge")
      .isInt({ min: 0 })
      .withMessage("Valid patient age required"),
    body("patientGender")
      .isIn(["male", "female", "other"])
      .withMessage("Valid gender required"),
    body("emergencyType").notEmpty().withMessage("Emergency type required"),
    body("description").notEmpty().withMessage("Description required"),
    body("severity")
      .isIn(["critical", "high", "medium", "low"])
      .withMessage("Valid severity required"),
    body("currentLocation").notEmpty().withMessage("Current location required"),
  ],
  emergencyRequestController.createEmergencyRequest,
);

// @route   POST /api/emergency/requests/patient
// @desc    Create emergency request by patient
// @access  Private (Patient)
router.post(
  "/patient",
  authenticate,
  resolveTenant,
  [
    body("emergencyType").notEmpty().withMessage("Emergency type required"),
    body("description").notEmpty().withMessage("Description required"),
    body("severity")
      .isIn(["critical", "high", "medium", "low"])
      .withMessage("Valid severity required"),
    body("currentLocation").notEmpty().withMessage("Current location required"),
    body("hospitalId")
      .optional()
      .isMongoId()
      .withMessage("Valid Hospital ID required"),
    body("hospitalIds")
      .optional()
      .isArray()
      .withMessage("Hospital IDs must be an array"),
  ],
  emergencyRequestController.createPatientEmergencyRequest,
);

// @route   GET /api/emergency/requests/patient/my-requests
// @desc    Get all requests by patient
// @access  Private (Patient)
router.get(
  "/patient/my-requests",
  authenticate,
  resolveTenant,
  emergencyRequestController.getPatientEmergencyRequests,
);

// @route   GET /api/emergency/requests/my-requests
// @desc    Get all requests by ambulance personnel
// @access  Private (Ambulance Personnel)
router.get(
  "/my-requests",
  authenticateEmergencyPersonnel,
  emergencyRequestController.getMyEmergencyRequests,
);

// @route   GET /api/emergency/requests/hospital
// @desc    Get emergency requests for hospital (helpdesk view)
// @access  Private (Helpdesk)
router.get(
  "/hospital",
  authenticate,
  resolveTenant,
  emergencyRequestController.getHospitalEmergencyRequests,
);

// @route   GET /api/emergency/requests/hospital/stats
// @desc    Get dashboard stats for hospital emergency view
// @access  Private
router.get(
  "/hospital/stats",
  authenticate,
  resolveTenant,
  emergencyRequestController.getEmergencyStats,
);

// @route   GET /api/emergency/hospitals
// @desc    Get all available hospitals
// @access  Private (Ambulance Personnel)
router.get(
  "/hospitals",
  authenticateEmergencyPersonnel,
  emergencyRequestController.getAvailableHospitals,
);

// @route   GET /api/emergency/requests/:requestId
// @desc    Get emergency request by ID
// @access  Private
router.get(
  "/:requestId",
  authenticate, // authenticate can handle both patient and personnel depending on context, or use a multi-auth if needed
  resolveTenant,
  emergencyRequestController.getEmergencyRequestById,
);

// @route   PUT /api/emergency/requests/:requestId/accept
// @desc    Accept emergency request
// @access  Private (Helpdesk)
router.put(
  "/:requestId/accept",
  authenticate,
  resolveTenant,
  emergencyRequestController.acceptEmergencyRequest,
);

// @route   PUT /api/emergency/requests/:requestId/reject
// @desc    Reject emergency request
// @access  Private (Helpdesk)
router.put(
  "/:requestId/reject",
  authenticate,
  resolveTenant,
  [body("rejectionReason").optional().isString()],
  emergencyRequestController.rejectEmergencyRequest,
);

export default router;
