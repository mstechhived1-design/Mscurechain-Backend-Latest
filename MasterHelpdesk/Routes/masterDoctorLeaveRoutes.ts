import express from "express";
import {
  createDoctorLeave,
  getDoctorLeaves,
  getDoctorLeaveById,
  getLeavesByDoctor,
  updateDoctorLeaveStatus,
  deleteDoctorLeave,
  getDoctorLeaveSummary,
} from "../Controllers/masterDoctorLeaveController.js";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";

const router = express.Router();

// All routes require authentication + masterhelpdesk (or higher) role
router.use(protect);
router.use(authorize("masterhelpdesk", "super-admin", "hospital-admin"));
router.use(resolveTenant);

// Summary / stats
router.get("/summary", getDoctorLeaveSummary);

// All leaves for the hospital (filter by doctorId / status via query params)
router.get("/", getDoctorLeaves);

// Leaves for a specific doctor (profile ID or user ID)
router.get("/doctor/:doctorId", getLeavesByDoctor);

// Single leave record
router.get("/:leaveId", getDoctorLeaveById);

// Create a leave request
router.post("/", createDoctorLeave);

// Approve or reject
router.patch("/:leaveId/status", updateDoctorLeaveStatus);
router.put("/:leaveId/status", updateDoctorLeaveStatus);

// Delete pending leave
router.delete("/:leaveId", deleteDoctorLeave);

export default router;
