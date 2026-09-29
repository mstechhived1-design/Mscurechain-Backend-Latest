import { Request, Response } from "express";
import VitalsAlert from "../Models/VitalsAlert.js";
import ApiError from "../../utils/ApiError.js";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import mongoose from "mongoose";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";

// @desc    Get active alerts for a hospital or specific doctor
// @route   GET /api/v1/ipd/alerts
// @access  Private
export const getActiveAlerts = asyncHandler(async (req: Request, res: Response) => {
    const { hospitalId, doctorId } = req.query;

    let query: any = { status: "Active" };
    if (hospitalId) query.hospital = hospitalId;

    let finalDoctorId = doctorId;
    if ((req as any).user?.role === "doctor" && (!finalDoctorId || finalDoctorId === "all")) {
        const doctorProfile = await DoctorProfile.findOne({ user: (req as any).user._id });
        if (doctorProfile) {
            finalDoctorId = doctorProfile._id.toString();
        }
    }

    if (finalDoctorId && finalDoctorId !== "all") {
        query.assignedDoctor = finalDoctorId;
    }

    const alerts = await VitalsAlert.find(query)
        .populate("patient", "name mrn")
        .populate("admission", "admissionId admissionType")
        .populate("vitalsRecord")
        .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: alerts, message: "Active alerts fetched successfully" });
});

// @desc    Acknowledge or Resolve an alert
// @route   PATCH /api/v1/ipd/alerts/:alertId
// @access  Private
export const updateAlertStatus = asyncHandler(async (req: Request, res: Response) => {
    const { alertId } = req.params;
    const { status, notes, userId } = req.body;

    if (!status || !userId) {
        throw new ApiError(400, "Status and userId are required");
    }

    const alert = await VitalsAlert.findById(alertId);
    if (!alert) {
        throw new ApiError(404, "Alert not found");
    }

    alert.status = status;
    alert.auditLog.push({
        action: `Alert ${status}`,
        user: new mongoose.Types.ObjectId(userId as string),
        timestamp: new Date(),
        notes
    });

    await alert.save();

    return res.status(200).json({ success: true, data: alert, message: `Alert marked as ${status}` });
});

// @desc    Get alert history for a patient
// @route   GET /api/v1/ipd/alerts/history/:patientId
// @access  Private
export const getPatientAlertHistory = asyncHandler(async (req: Request, res: Response) => {
    const { patientId } = req.params;
    const history = await VitalsAlert.find({ patient: patientId })
        .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: history, message: "Patient alert history fetched successfully" });
});
