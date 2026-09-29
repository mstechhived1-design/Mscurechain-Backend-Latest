import { Request, Response } from "express";
import mongoose from "mongoose";
import DischargeRecord from "../Models/DischargeRecord.js";
import dischargeService from "../../services/discharge.service.js";
import User from "../../Auth/Models/User.js";
import { createNotification } from "../../Notification/Controllers/notificationController.js";
import PendingDischarge from "../Models/PendingDischarge.js";

// Helper function to send discharge notifications
const sendDischargeNotifications = async (req: any, dischargeData: any) => {
  try {
    const hospitalId = req.user.hospital;
    console.log(
      "[NOTIFICATION DEBUG] Starting discharge notifications for:",
      dischargeData.mrn,
    );

    // 1. Find Nurse role users
    const nurseUsers = await (
      User.find({
        hospital: hospitalId,
        role: "nurse",
        status: "active",
      }) as any
    ).unscoped();

    // 2. Find Helpdesk users
    const helpdeskUsers = await (
      User.find({
        hospital: hospitalId,
        role: "helpdesk",
        status: "active",
      }) as any
    ).unscoped();

    // 3. Find Primary Doctor
    let primaryDoctorUser;
    if (dischargeData.primaryDoctor) {
      // Assuming primaryDoctor name is stored, we might need to find the User by name or better store ID
      // Ideally dischargeData should have primaryDoctorId. If not, we try to find by name match or skip
      // For now, attempting to find if direct ID link exists or name match
      primaryDoctorUser = await (
        User.findOne({
          hospital: hospitalId,
          name: dischargeData.primaryDoctor,
          role: "doctor",
        }) as any
      ).unscoped();
    }

    const allRecipients = [...nurseUsers, ...helpdeskUsers];
    if (primaryDoctorUser) allRecipients.push(primaryDoctorUser);

    // Remove duplicates
    const uniqueRecipients = Array.from(
      new Set(allRecipients.map((u) => u._id.toString())),
    ).map((id) => allRecipients.find((u) => u._id.toString() === id));

    console.log(
      `[NOTIFICATION DEBUG] Found ${uniqueRecipients.length} recipients`,
    );

    // Create notifications
    for (const recipient of uniqueRecipients) {
      if (!recipient) continue;

      try {
        await createNotification(req, {
          hospital: hospitalId,
          recipient: recipient._id,
          sender: req.user._id,
          type: "discharge_pending",
          message: `Discharge Request: ${dischargeData.patientName} (${dischargeData.ipNo}) - ${dischargeData.roomType}`,
          relatedId: dischargeData._id,
        });
        console.log(
          `[NOTIFICATION DEBUG] Sent to ${recipient.role}: ${recipient.name}`,
        );

        // Socket
        if (req.io) {
          req.io.to(`user_${recipient._id}`).emit("notification:new", {
            type: "discharge_pending",
            message: `Discharge Request: ${dischargeData.patientName}`,
            patientName: dischargeData.patientName,
            mrn: dischargeData.mrn,
            createdAt: new Date(),
          });
        }
      } catch (err) {
        console.error(
          `[NOTIFICATION DEBUG] Failed for user ${recipient._id}:`,
          err,
        );
      }
    }

    return uniqueRecipients.length;
  } catch (error) {
    console.error("[NOTIFICATION DEBUG] Fatal Error:", error);
    return 0;
  }
};

export const dischargeRecordController = {
  // Get dashboard stats
  getStats: async (req: any, res: Response) => {
    try {
      const hospitalId = req.user.hospital || req.query.hospitalId;
      const stats = await dischargeService.getDashboardStats(hospitalId);
      res.status(200).json({ success: true, stats });
    } catch (error: any) {
      console.error("Error fetching discharge stats:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },
  // Create new record
  saveRecord: async (req: any, res: Response) => {
    try {
      const hospitalId = req.user.hospital;
      if (!hospitalId) {
        return res.status(400).json({
          success: false,
          error: "Your account is not associated with any hospital.",
        });
      }

      const IPDAdmission = (await import("../../IPD/Models/IPDAdmission.js"))
        .default;
      const isNurse = req.user.role === "nurse";
      const isHelpdesk =
        req.user.role === "helpdesk" || req.user.role === "hospital-admin";

      // If Nurse, only update/upsert PendingDischarge (the Draft)
      if (isNurse) {
        // AUTO-FILL MISSING DATA: If fields are missing in the request body, fetch them from the source of truth
        let finalData = { ...req.body };
        if (
          !finalData.bedNo ||
          !finalData.roomNo ||
          !finalData.roomType ||
          !finalData.specialistType
        ) {
          console.log(
            "[DISCHARGE] POST missing fields, fetching from service...",
          );
          try {
            const freshData = await dischargeService.getAdmissionDetails(
              req.body.admissionId,
            );
            finalData = {
              ...freshData, // Fill from service first
              ...finalData, // Overwrite with values user explicitly provided
              vitals: {
                ...(freshData.vitals || {}),
                ...(finalData.vitals || {}),
              },
            };
          } catch (err) {
            console.error("[DISCHARGE] Auto-fill failed during POST:", err);
          }
        }

        const draftData = {
          ...finalData,
          hospital: hospitalId,
          createdBy: req.user._id,
          preparedBy: req.user._id,
          status: "PREPARED_BY_NURSE",
        };

        const draft = await (
          PendingDischarge.findOneAndUpdate(
            { admissionId: req.body.admissionId },
            draftData,
            { upsert: true, new: true },
          ) as any
        ).unscoped();

        return res.status(200).json({
          success: true,
          message: "Discharge form prepared by nurse (with auto-fill)",
          data: draft,
        });
      }

      // If Helpdesk, Finalize and create permanent DischargeRecord
      // First, check if a record already exists to prevent duplicates
      const existingRecord = await (
        DischargeRecord.findOne({
          admissionId: req.body.admissionId,
        }) as any
      ).unscoped();
      if (existingRecord) {
        return res.status(400).json({
          success: false,
          message: "Discharge record already exists for this admission.",
        });
      }

      // ✅ NABH BILLING TAT FIX: Read dischargeAdviceAt from PendingDischarge draft
      // before we delete it. Without this, billingTat was always 0 because the
      // field was set on PendingDischarge (doctor's side) but never carried over
      // to the final DischargeRecord (helpdesk side).
      const billingDraft = await (
        PendingDischarge.findOne({ admissionId: req.body.admissionId }) as any
      ).unscoped().lean();
      const dischargeAdviceAt =
        billingDraft?.dischargeAdviceAt ||
        req.body.dischargeAdviceAt ||
        null;

      const recordData = {
        ...req.body,
        hospital: hospitalId,
        createdBy: req.user._id,
        preparedBy: req.body.preparedBy || req.body.createdBy, // Carry over from draft
        status: "completed",
        paymentSettledAt: new Date(),
        dischargeAdviceAt, // ✅ NABH TAT: clock started when doctor advised discharge
        // NEW FINANCIAL CALCULATIONS
        remainingAmount: Math.round(Number(req.body.totalBillAmount || 0) - Number(req.body.advanceAmount || 0)),
        totalPaidAmount: Math.round(Number(req.body.advanceAmount || 0) + Number(req.body.finalPayment || 0)),
      };

      const record = new DischargeRecord(recordData);
      await record.save();

      // Create Transaction for Final Settlement if any
      const settlementAmt = Math.round(Number(req.body.finalPayment || 0));
      if (settlementAmt > 0) {
        const admission = await (
          IPDAdmission.findOne({
            admissionId: req.body.admissionId,
          }) as any
        )
          .unscoped()
          .lean()
          .exec();

        // ✅ RECORD IN ADMISSION: Increment settlementPaid and update balanceDue
        if (admission) {
          const newTotalBill = Number(req.body.totalBillAmount || admission.totalBilledAmount || 0);
          const newAdvance = Number(req.body.advanceAmount || admission.advancePaid || 0);

          await (
            IPDAdmission.findByIdAndUpdate(admission._id, {
              $set: {
                settlementPaid: settlementAmt,
                totalBilledAmount: newTotalBill,
                advancePaid: newAdvance,
                balanceDue: Math.max(0, newTotalBill - newAdvance - settlementAmt),
              },
            }) as any
          )
            .unscoped()
            .exec();
        }

        const Transaction = (await import("../../Admin/Models/Transaction.js"))
          .default;
        await new Transaction({
          user: admission?.patient || req.user._id,
          hospital: hospitalId,
          amount: settlementAmt,
          type: "ipd_final_settlement",
          status: "completed",
          referenceId: record._id,
          date: new Date(),
          paymentMode: req.body.paymentMode || "cash",
        }).save();
      }

      // Clean up: Update IPDAdmission and Delete Draft
      await (
        IPDAdmission.findOneAndUpdate(
          { admissionId: req.body.admissionId },
          { status: "Discharged" },
        ) as any
      )
        .unscoped()
        .exec();
      await (
        PendingDischarge.findOneAndDelete({
          admissionId: req.body.admissionId,
        }) as any
      )
        .unscoped()
        .exec();

      console.log(
        "[DISCHARGE] Final record saved by Helpdesk/Admin for:",
        req.body.admissionId,
      );

      // TRIGGER NOTIFICATIONS
      await sendDischargeNotifications(req, record);

      res.status(201).json({
        success: true,
        message: "Discharge finalized & notifications sent",
        data: record,
      });
    } catch (error: any) {
      console.error("Error saving discharge record:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Get all records (History)
  getHistory: async (req: any, res: Response) => {
    try {
      const user = req.user;
      const hospitalId = user?.hospital || req.query.hospitalId;

      if (!hospitalId) {
        console.warn(
          "[HISTORY] No hospitalId found in request for user:",
          user?._id,
        );
        return res.status(200).json({
          success: true,
          data: [],
          pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
        });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const skip = (page - 1) * limit;

      // Ensure hospitalId is always treated consistently (Mongoose handles casting, but logging needs clarity)
      const hOid =
        typeof hospitalId === "string"
          ? new mongoose.Types.ObjectId(hospitalId)
          : hospitalId;
      let query: any = { hospital: hOid };

      if (search && search.length >= 3) {
        query.$or = [
          { patientName: { $regex: search, $options: "i" } },
          { mrn: { $regex: search, $options: "i" } },
          { ipNo: { $regex: search, $options: "i" } },
        ];
      }

      console.log(
        `[HISTORY] Fetching for hospital: ${hOid}, page: ${page}, limit: ${limit}`,
      );

      // Fetch records and total count in parallel for performance
      const projection =
        "patientName phone mrn gender age ipNo admissionId primaryDoctor department dischargeDate status createdAt createdBy hospitalName hospitalLogo hospitalAddress hospitalState hospitalPhone hospitalRegNo roomType bedNo";

      const [records, total] = await Promise.all([
        (DischargeRecord.find(query) as any)
          .unscoped()
          .select(projection)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        (DischargeRecord.countDocuments(query) as any).unscoped(),
      ]);

      console.log(
        `[HISTORY] Found ${records.length} records. Total documents: ${total}`,
      );

      // Return raw records for speed
      // The frontend should handle missing hospital details if any
      const mappedRecords = records;

      res.status(200).json({
        success: true,
        data: mappedRecords,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / (limit || 1)),
        },
      });
    } catch (error: any) {
      console.error("[HISTORY] CRITICAL ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error while fetching history",
      });
    }
  },

  // Get single record
  getRecordById: async (req: Request, res: Response) => {
    try {
      const record: any = await (DischargeRecord.findById(req.params.id) as any)
        .unscoped()
        .populate("hospital")
        .populate("createdBy", "image avatar")
        .lean();

      if (!record) {
        return res
          .status(404)
          .json({ success: false, message: "Record not found" });
      }

      // Map hospital details
      const data = {
        ...record,
        hospitalName: record.hospitalName || record.hospital?.name,
        hospitalAddress: record.hospitalAddress || record.hospital?.address,
        hospitalState: record.hospitalState || record.hospital?.state,
        hospitalPhone: record.hospitalPhone || record.hospital?.phone,
        // Smart logo resolution: 1. Record snapshot, 2. Hospital Record, 3. Creator Profile
        hospitalLogo:
          record.hospitalLogo ||
          record.hospital?.logo ||
          record.createdBy?.image ||
          record.createdBy?.avatar,
        hospitalRegNo:
          record.hospitalRegNo ||
          record.hospital?.registrationNumber ||
          record.hospital?.hospitalId,
      };

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error: any) {
      console.error("Error fetching record details:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Update existing record
  updateRecord: async (req: any, res: Response) => {
    try {
      // Prevent updating immutable fields or fields that might cause casting errors if empty
      const { createdBy, hospital, ...updateData } = req.body;

      const record = await (
        DischargeRecord.findByIdAndUpdate(req.params.id, updateData, {
          new: true,
          runValidators: true,
        }) as any
      ).unscoped();

      if (!record) {
        return res
          .status(404)
          .json({ success: false, message: "Record not found" });
      }

      res.status(200).json({
        success: true,
        message: "Discharge record updated successfully",
        data: record,
      });
    } catch (error: any) {
      console.error("Error updating discharge record:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Delete record
  deleteRecord: async (req: Request, res: Response) => {
    try {
      const record = await (
        DischargeRecord.findByIdAndDelete(req.params.id) as any
      ).unscoped();

      if (!record) {
        return res
          .status(404)
          .json({ success: false, message: "Record not found" });
      }

      res.status(200).json({
        success: true,
        message: "Discharge record deleted successfully",
      });
    } catch (error: any) {
      console.error("Error deleting discharge record:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Get pending discharges from the Draft (PendingDischarge) model
  getPendingDischarges: async (req: any, res: Response) => {
    try {
      const user = req.user;

      if (!user.hospital) {
        return res.status(200).json({ success: true, data: [], count: 0 });
      }

      // 🚀 OPTIMIZED: Direct query without excessive debugging
      const hospitalId = new mongoose.Types.ObjectId(user.hospital.toString());
      const query = {
        hospital: hospitalId,
        status: { $in: ["REQUESTED", "PREPARED_BY_NURSE"] },
      };

      const pendingDischarges = await (PendingDischarge.find(query) as any)
        .unscoped()
        .select(
          "patientName mrn ipNo admissionId primaryDoctor department status updatedAt createdAt bedNo roomType",
        )
        .sort({ updatedAt: -1 })
        .lean();

      res.status(200).json({
        success: true,
        data: pendingDischarges,
        count: pendingDischarges.length,
      });
    } catch (error: any) {
      console.error("[getPendingDischarges] Error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Get all discharge records for a patient (Patient Portal)
  getPatientDischargeRecords: async (req: any, res: Response) => {
    try {
      const patientUser = req.user;

      if (!patientUser) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      // Patient model has `mobile` but NOT `mrn` — mrn lives in PatientProfile.
      // We must look up mrn from PatientProfile first to build a reliable query.
      const PatientProfile = (
        await import("../../Patient/Models/PatientProfile.js")
      ).default;

      const profile = await (
        PatientProfile.findOne({ user: patientUser._id }) as any
      )
        .unscoped()
        .select("mrn")
        .lean();

      const patientMobile = patientUser.mobile?.trim();
      const patientMrn = profile?.mrn?.trim();

      console.log(
        `[PatientRecords] Lookup for userId=${patientUser._id}, mobile=${patientMobile}, mrn=${patientMrn}`
      );

      // Build $or conditions — only add non-empty values to avoid wildcard matches
      const orConditions: any[] = [];
      if (patientMobile) orConditions.push({ phone: patientMobile });
      if (patientMrn) orConditions.push({ mrn: patientMrn });

      if (orConditions.length === 0) {
        console.warn(
          `[PatientRecords] No mobile or MRN found for patient ${patientUser._id} — returning empty`
        );
        return res
          .status(200)
          .json({ success: true, data: [], count: 0 });
      }

      const records = await (
        DischargeRecord.find({ $or: orConditions }) as any
      )
        .unscoped()
        .sort({ dischargeDate: -1 })
        .limit(20)
        .populate("hospital", "name address logo")
        .lean();

      console.log(
        `[PatientRecords] Found ${records.length} records for patient ${patientUser._id}`
      );

      // Map hospital details from either snapshot or populated field
      const mappedRecords = records.map((record: any) => ({
        ...record,
        hospitalName: record.hospitalName || record.hospital?.name,
        hospitalAddress: record.hospitalAddress || record.hospital?.address,
        hospitalLogo: record.hospitalLogo || record.hospital?.logo,
      }));

      res.status(200).json({
        success: true,
        data: mappedRecords,
        count: mappedRecords.length,
      });
    } catch (error: any) {
      console.error("Error fetching patient discharge records:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },


  // Get summary for patient (Secure)
  getPatientSummary: async (req: any, res: Response) => {
    try {
      // Identifier can be documentId or admissionId
      const { identifier } = req.params;
      const patientUser = req.user;

      if (!identifier) {
        return res
          .status(400)
          .json({ success: false, message: "Identifier is required" });
      }

      const orConditions: any[] = [
        { documentId: identifier },
        { admissionId: identifier },
      ];

      if (mongoose.Types.ObjectId.isValid(identifier)) {
        orConditions.push({ _id: identifier });
      }

      // Find by documentId OR admissionId OR _id
      const record = await (
        DischargeRecord.findOne({
          $or: orConditions,
        }) as any
      )
        .unscoped()
        .populate("hospital")
        .lean();

      if (!record) {
        return res
          .status(404)
          .json({ success: false, message: "Discharge summary not found" });
      }

      // Map hospital details
      const data = {
        ...record,
        hospitalName:
          (record as any).hospitalName || (record as any).hospital?.name,
        hospitalAddress:
          (record as any).hospitalAddress || (record as any).hospital?.address,
        hospitalState:
          (record as any).hospitalState || (record as any).hospital?.state,
        hospitalPhone:
          (record as any).hospitalPhone || (record as any).hospital?.phone,
        hospitalLogo:
          (record as any).hospitalLogo || (record as any).hospital?.logo,
        hospitalRegNo:
          (record as any).hospitalRegNo ||
          (record as any).hospital?.registrationNumber ||
          (record as any).hospital?.hospitalId,
      };

      // SECURITY CHECK: Ensure the logged-in user owns this record
      // Allow staff or the patient whose record this is

      const isStaff = [
        "doctor",
        "admin",
        "helpdesk",
        "nurse",
        "hospital-admin",
      ].includes(patientUser.role);

      if (!isStaff) {
        // Patient model has `mobile` but NOT `mrn` — look up PatientProfile for MRN
        const PatientProfile = (
          await import("../../Patient/Models/PatientProfile.js")
        ).default;

        const profile = await (
          PatientProfile.findOne({ user: patientUser._id }) as any
        )
          .unscoped()
          .select("mrn")
          .lean();

        const patientMobile = patientUser.mobile?.trim();
        const patientMrn = profile?.mrn?.trim();

        const isOwner =
          (patientMobile && record.phone === patientMobile) ||
          (patientMrn && record.mrn === patientMrn);

        if (!isOwner) {
          console.warn(
            `[PatientSummary] Access denied for patient ${patientUser._id}: ` +
            `record.phone=${record.phone}, patient.mobile=${patientMobile}, ` +
            `record.mrn=${record.mrn}, patient.mrn=${patientMrn}`
          );
          return res.status(403).json({
            success: false,
            message: "Unauthorized access to this discharge record",
          });
        }
      }

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error: any) {
      console.error("Error fetching patient summary:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Get admission details for auto-fill (Smart Merge: Draft + Fresh Vitals)
  getAdmissionData: async (req: any, res: Response) => {
    try {
      const { id } = req.params; // Can be admissionId
      if (!id)
        return res
          .status(400)
          .json({ success: false, message: "ID is required" });

      console.log("[API] Resolving data for discharge form:", id);

      // 1. Fetch Fresh Vitals from IPDAdmission Source of Truth
      const IPDAdmission = (await import("../../IPD/Models/IPDAdmission.js"))
        .default;
      const freshAdmission = await (
        IPDAdmission.findOne({ admissionId: id }) as any
      )
        .unscoped()
        .select("vitals")
        .lean();

      console.log("[API] Fresh Vitals Source:", freshAdmission?.vitals);

      const freshVitals = freshAdmission?.vitals
        ? {
          ...freshAdmission.vitals,
          glucose: freshAdmission.vitals.glucose || "",
          status: freshAdmission.vitals.status || "",
          condition: freshAdmission.vitals.condition || "",
        }
        : {};

      // 2. Check if a PendingDischarge (Draft) exists
      const draft = await (PendingDischarge.findOne({ admissionId: id }) as any)
        .unscoped()
        .populate("createdBy", "name")
        .lean();

      if (draft) {
        console.log("[API] Found draft data for:", id);
        // Merge fresh vitals into draft to ensure latest clinical status
        const mergedDraft = {
          ...draft,
          vitals: {
            ...(draft.vitals || {}),
            ...freshVitals, // Overwrite draft vitals with fresh ones
          },
        };
        return res.status(200).json(mergedDraft);
      }

      // 3. Fallback to IPDAdmission service (standard auto-fill)
      console.log("[API] No draft found, fetching fresh admission details");
      const data = await dischargeService.getAdmissionDetails(id);
      res.status(200).json(data);
    } catch (error: any) {
      console.error("[API] Error resolving discharge data:", error);
      res.status(404).json({
        success: false,
        message: error.message || "Admission details not found",
      });
    }
  },
};
