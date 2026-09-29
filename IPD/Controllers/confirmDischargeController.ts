import { Request, Response } from "express";
import mongoose from "mongoose";
import IPDAdmission from "../Models/IPDAdmission.js";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import redisService from "../../config/redis.js";
import BedOccupancy from "../Models/BedOccupancy.js";
import Bed from "../Models/Bed.js";

const invalidateIPDCache = async (
  hospitalId: string,
  bedIds?: string | string[],
) => {
  const promises = [
    redisService.del(`ipd:admissions:active:${hospitalId}`),
    redisService.del(`nurse:stats:${hospitalId}`),
    redisService.delPattern(`ipd:beds:${hospitalId}*`),
  ];

  if (bedIds) {
    const ids = Array.isArray(bedIds) ? bedIds : [bedIds];
    ids.forEach((id) => {
      promises.push(redisService.del(`ipd:bed:details:${id}`));
    });
  }

  await Promise.all(promises);
};

export const confirmDischarge = asyncHandler(
  async (req: Request, res: Response) => {
    const { admissionId } = req.params;
    // Don't rely on req.user.hospital for data creation, get it from the source of truth (the admission)

    // Import models dynamically to avoid circular dependencies
    const DischargeRecord = (
      await import("../../Discharge/Models/DischargeRecord.js")
    ).default;
    const User = (await import("../../Auth/Models/User.js")).default;
    const { createNotification } =
      await import("../../Notification/Controllers/notificationController.js");

    // Resilient admission lookup (handles both string ID and ObjectId)
    const admission = await IPDAdmission.findOne({
      $or: [
        { admissionId: admissionId },
        { _id: mongoose.isValidObjectId(admissionId) ? admissionId : null },
      ],
      status: { $in: ["Active", "Discharged", "Discharge Initiated"] },
    })
      .populate("patient")
      .populate({
        path: "primaryDoctor",
        populate: { path: "user", select: "name email" },
      });

    if (!admission) {
      console.error(
        "[DISCHARGE] ERROR: Admission not found for admissionId:",
        admissionId,
      );
      throw new ApiError(404, "Admission not found");
    }

    const hospital = admission.hospital;

    if (admission.status === "Discharged") {
      console.log("[DISCHARGE] Admission already discharged:", admissionId);
      return res.status(200).json({
        success: true,
        message: "Admission is already discharged",
        alreadyProcessed: true,
      });
    }

    // Use dischargeService to get fully resolved data (including MRN from PatientProfile)
    const dischargeService = (
      await import("../../services/discharge.service.js")
    ).default;
    const PendingDischarge = (
      await import("../../Discharge/Models/PendingDischarge.js")
    ).default;

    let dischargeData;
    try {
      dischargeData = await dischargeService.getAdmissionDetails(
        admission.admissionId,
      );
    } catch (error) {
      console.error("[DISCHARGE] Error fetching admission details:", error);
      // Fallback if service fails
      dischargeData = {
        patientName: (admission.patient as any)?.name || "Unknown",
        mrn: (admission as any).patient?.mrn || "N/A",
        admissionId: admission.admissionId,
      };
    }

    // ✅ PHARMACY CLEARANCE GATE — SMART RECONCILIATION
    // If medicines were issued, pharmacy must sign-off.
    // However, we auto-clear if the bill is settled or if no returns are pending.
    if (admission.pharmacyClearanceStatus === "PENDING") {
      const roundedBalance = Math.round(admission.balanceDue ?? 0);

      // Import MedicineReturn model
      const MedicineReturn = (
        await import("../../Pharmacy/Models/MedicineReturn.js")
      ).default;

      // Check for any PENDING return requests
      const pendingReturns = await MedicineReturn.countDocuments({
        admissionId: admission.admissionId,
        hospital,
        status: "PENDING",
      });

      if ((admission.isBillLocked && roundedBalance <= 0) || pendingReturns === 0) {
        // Auto-promote pharmacy clearance so discharge can proceed
        admission.pharmacyClearanceStatus = "CLEARED";
        await admission.save();
        console.log(
          `[DISCHARGE] Auto-cleared pharmacy status for ${admissionId}. Reason: ${pendingReturns === 0 ? "No pending returns" : "Bill settled"}`,
        );
      } else {
        throw new ApiError(
          400,
          `Discharge blocked: Pharmacy clearance is pending. There are ${pendingReturns} medicine return(s) that must be verified by the pharmacist.`,
        );
      }
    }

    // Create or Update PendingDischarge (the Draft)
    const dischargeInitiatedTimestamp = new Date();
    const pendingData = {
      ...dischargeData,
      hospital,
      createdBy: (req as any).user._id,
      status: "REQUESTED",
      dischargeAdviceAt: dischargeInitiatedTimestamp, // NABH TAT Trigger: Clock starts now
      dischargeDate: dischargeInitiatedTimestamp, // Exact timestamp when frontdesk initiated discharge
    };

    console.log(
      "[DISCHARGE DEBUG] Saving PendingDischarge with hospital:",
      hospital.toString(),
    );

    await PendingDischarge.findOneAndUpdate(
      { admissionId: admission.admissionId },
      pendingData,
      { upsert: true, new: true },
    );

    // Update admission status
    admission.status = "Discharge Initiated";
    admission.dischargeRequested = false;
    admission.dischargeDate = dischargeInitiatedTimestamp;
    await admission.save();

    console.log(
      "[DISCHARGE] PendingDischarge created/updated and admission status set:",
      admissionId,
    );

    // Find all users who should receive this notification in the same hospital
    const recipientUsers = await User.find({
      hospital,
      role: { $in: ["nurse", "helpdesk", "hospital-admin"] },
      status: "active",
    }).select("_id name role");

    // Get the primary doctor's user record
    const doctorUser = (admission.primaryDoctor as any)?.user;

    // Deduplicate and combine recipients
    const allRecipientsMap = new Map<string, any>();
    recipientUsers.forEach((user) =>
      allRecipientsMap.set(user._id.toString(), user),
    );
    if (doctorUser && doctorUser._id) {
      allRecipientsMap.set(doctorUser._id.toString(), doctorUser);
    }
    const allRecipients = Array.from(allRecipientsMap.values());

    // Notification Message with proper MRN from dischargeData
    const notificationMessage = `New discharge pending: ${dischargeData.patientName} (${admission.admissionId})`;

    for (const recipient of allRecipients) {
      await createNotification(req, {
        hospital,
        recipient: recipient._id,
        sender: (req as any).user._id,
        type: "discharge_pending",
        message: notificationMessage,
        relatedId: admission._id,
      });
    }

    // Update Bed Status to 'Cleaning' and remove BedOccupancy as requested
    const bedOccupancy = await BedOccupancy.findOne({
      admission: admission._id,
      $or: [{ endDate: { $exists: false } }, { endDate: null }],
    });

    let bedIdToClear: string | undefined = undefined;

    if (bedOccupancy) {
      bedIdToClear = bedOccupancy.bed.toString();
      const bedId = bedOccupancy.bed;

      // 1. End the occupancy record instead of deleting it to preserve history for billing
      bedOccupancy.endDate = new Date();
      await bedOccupancy.save();
      console.log(
        `[DISCHARGE] Ended BedOccupancy record for admission: ${admissionId}`,
      );

      if (bedId) {
        // 2. FORCE update bed status to 'Cleaning'
        // Use updateOne to ensure it matches the specific bed independently of hospital context in req if needed
        const bedUpdate = await Bed.updateOne(
          { _id: bedId },
          { $set: { status: "Cleaning" } },
        );
        console.log(
          `[DISCHARGE] Bed ${bedId} status updated to Cleaning. Matched: ${bedUpdate.matchedCount}, Modified: ${bedUpdate.modifiedCount}`,
        );
      }
    } else {
      console.warn(
        `[DISCHARGE] No active BedOccupancy found for admission: ${admissionId}. Status might already be handled.`,
      );
    }

    // Broadcast for immediate UI update in portals
    if ((req as any).io) {
      // Emit to the hospital room to ensure all relevant staff hear it
      const hospitalIdStr = hospital.toString();
      const hospitalRoom = `hospital_${hospitalIdStr}`;
      (req as any).io.to(hospitalRoom).emit("notification:new", {
        type: "discharge_pending",
        message: notificationMessage,
        relatedId: admission._id,
        admissionId: admission.admissionId,
        hospitalId: hospitalIdStr,
      });

      // ✅ REAL-TIME SYNC: Notify all users about the bed status change
      (req as any).io.to(hospitalRoom).emit("ipd:bed_updated", {
        type: "discharge",
        admissionId: admission.admissionId,
        bedId: bedOccupancy?.bed?.toString(),
      });

      console.log(
        `[SOCKET] Broadcasted update to room: ${hospitalRoom} for admission: ${admission.admissionId}`,
      );
    }

    // Invalidate cache
    await invalidateIPDCache(hospital.toString(), bedIdToClear);

    res.status(200).json({
      success: true,
      message: `Discharge initiated. Notifications sent to ${allRecipients.length} users.`,
      data: {
        admissionId: admission.admissionId,
        notificationCount: allRecipients.length,
        mrn: dischargeData.mrn,
      },
    });
  },
);
