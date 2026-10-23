import { Request, Response } from "express";
import mongoose from "mongoose";
import PatientMedicineIntake from "../Models/PatientMedicineIntake.js";
import Notification from "../../Notification/Models/Notification.js";
import { PatientRequest } from "../types/index.js";

/**
 * Record or undo taking a prescribed dose.
 * Dynamically computes consumed and remaining tablet counts.
 */
export const recordDoseIntake = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const userId = (req.body?.patientId || req.query?.patientId || patientReq.user?._id) as string;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const {
      prescriptionId,
      medicineId,
      medicineName,
      dosage,
      timeSlot,
      scheduledTime,
      date,
      isTaken,
      totalQuantity,
    } = req.body;

    if (!prescriptionId || !medicineId || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: "prescriptionId, medicineId, and timeSlot are required",
      });
    }

    const targetDate = date || new Date().toISOString().split("T")[0];
    const cleanName = (medicineName || "").trim();
    const cleanLower = cleanName.toLowerCase();

    const userObjId = mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(String(userId)) : null;
    const patientQuery = userObjId ? { $in: [userId, userObjId] } : userId;

    const orConditions: any[] = [{ medicineId }];
    if (cleanName) {
      orConditions.push({
        medicineName: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      });
    }

    if (isTaken) {
      await PatientMedicineIntake.findOneAndUpdate(
        {
          patient: patientQuery,
          $or: orConditions,
          timeSlot: { $regex: new RegExp(`^${timeSlot}$`, "i") },
          date: targetDate,
        },
        {
          $set: {
            patient: userId,
            prescriptionId,
            medicineId,
            medicineName: cleanName || "Prescribed Medicine",
            dosage: dosage || "1 Dose",
            timeSlot,
            scheduledTime: scheduledTime || "",
            date: targetDate,
            takenAt: new Date(),
            status: "taken",
          },
        },
        { upsert: true, new: true }
      );
    } else {
      await PatientMedicineIntake.deleteMany({
        patient: patientQuery,
        $or: orConditions,
        timeSlot: { $regex: new RegExp(`^${timeSlot}$`, "i") },
        date: targetDate,
      });
    }

    // Dynamic consumed count computed from DB across all dates
    const consumedCount = await PatientMedicineIntake.countDocuments({
      patient: patientQuery,
      $or: orConditions,
      status: "taken",
    });

    const totalQty = parseInt(String(totalQuantity || "30"), 10) || 30;
    const remainingCount = Math.max(0, totalQty - consumedCount);

    return res.status(200).json({
      success: true,
      medicineId,
      timeSlot,
      isTaken: Boolean(isTaken),
      consumedCount,
      remainingCount,
      date: targetDate,
    });
  } catch (error: any) {
    console.error("[PatientMedicationController] recordDoseIntake error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to record medication dose",
    });
  }
};

/**
 * Get current medication statuses and remaining counts for active prescriptions.
 */
export const getPatientMedicationStatus = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const userId = (req.query?.patientId || req.body?.patientId || patientReq.user?._id) as string;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const targetDate = (req.query.date as string) || new Date().toISOString().split("T")[0];
    const userObjId = mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(String(userId)) : null;
    const patientQuery = userObjId ? { $in: [userId, userObjId] } : userId;

    // Query all intakes for this patient
    const allIntakes = await PatientMedicineIntake.find({
      patient: patientQuery,
      status: "taken",
    }).lean();

    const todayTakenMap: Record<string, boolean> = {};
    const consumedMap: Record<string, number> = {};

    allIntakes.forEach((item) => {
      const cleanName = (item.medicineName || "").trim().toLowerCase();
      const slot = (item.timeSlot || "").trim();
      const slotLower = slot.toLowerCase();

      // All-time consumed counts
      if (item.medicineId) {
        consumedMap[item.medicineId] = (consumedMap[item.medicineId] || 0) + 1;
      }
      if (cleanName) {
        consumedMap[cleanName] = (consumedMap[cleanName] || 0) + 1;
      }

      // Today's taken status
      if (item.date === targetDate) {
        if (item.medicineId && slot) {
          todayTakenMap[`${item.medicineId}_${slot}`] = true;
          todayTakenMap[`${item.medicineId}_${slotLower}`] = true;
        }
        if (cleanName && slot) {
          todayTakenMap[`${cleanName}_${slot}`] = true;
          todayTakenMap[`${cleanName}_${slotLower}`] = true;
        }
      }
    });

    return res.status(200).json({
      success: true,
      date: targetDate,
      todayTakenMap,
      consumedMap,
    });
  } catch (error: any) {
    console.error("[PatientMedicationController] getPatientMedicationStatus error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch medication statuses",
    });
  }
};

/**
 * Get paginated history of patient medicine intakes.
 */
export const getPatientMedicationHistory = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const userId = (req.query?.patientId || req.body?.patientId || patientReq.user?._id) as string;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit as string, 10) || 10));
    const skip = (page - 1) * limit;

    const [total, logs] = await Promise.all([
      PatientMedicineIntake.countDocuments({ patient: userId, status: "taken" }),
      PatientMedicineIntake.find({ patient: userId, status: "taken" })
        .sort({ takenAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      logs,
    });
  } catch (error: any) {
    console.error("[PatientMedicationController] getPatientMedicationHistory error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch medication intake history",
    });
  }
};

/**
 * Triggers in-app notification reminder for a scheduled medicine dose.
 */
export const triggerMedicineReminderNotification = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const userId = (req.body?.patientId || req.query?.patientId || patientReq.user?._id) as string;
    const { medicineName, dosage, timeSlot, hospitalId } = req.body;

    if (!userId || !medicineName) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    if (hospitalId) {
      await Notification.create({
        hospital: hospitalId,
        recipient: userId,
        recipientModel: "Patient",
        type: "MEDICINE_REMINDER",
        message: `Time to take your ${medicineName} (${dosage || "1 Dose"}) for ${timeSlot || "today"}.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Reminder notification dispatched successfully",
    });
  } catch (error: any) {
    console.error("[PatientMedicationController] triggerMedicineReminderNotification error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to trigger reminder notification",
    });
  }
};
