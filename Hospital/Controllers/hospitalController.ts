import { Request, Response } from "express";
import Hospital from "../Models/Hospital.js";
import mongoose from "mongoose";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Bed from "../../IPD/Models/Bed.js";
import Room from "../../IPD/Models/Room.js";
import IPDDepartment from "../../IPD/Models/IPDDepartment.js";
import Shift from "../../Staff/Models/Shift.js";
import VitalsThresholdTemplate from "../../IPD/Models/VitalsThresholdTemplate.js";

export const createHospital = async (req: Request, res: Response) => {
  try {
    const existing = await Hospital.findOne();
    if (existing) {
      return res.status(400).json({
        message:
          "Clinic/Hospital already exists. Only one is allowed in this version.",
      });
    }

    const count = await Hospital.countDocuments();
    req.body.hospitalId = "HOSP" + String(count + 1).padStart(4, "0");

    const hospital = await Hospital.create(req.body);

    // ─── Cache Invalidation ───────────────────────────────────────────────
    try {
      const { redisService } = await import("../../config/redis.js");
      await redisService.del("super_admin:hospitals:list");
    } catch (cacheErr) {
      console.warn("[createHospital] Cache invalidation failed (non-critical):", cacheErr);
    }

    res.status(201).json(hospital);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const listHospitals = async (req: Request, res: Response) => {
  try {
    const { lat, lng, radius, speciality } = req.query;
    // For now a simple filter
    const filter: any = {};
    if (speciality) filter.specialities = speciality;
    const hospitals = await Hospital.find(filter)
      .select("name address location phone specialities status branches")
      .lean()
      .limit(200);
    res.json(hospitals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getHospital = async (req: Request, res: Response) => {
  try {
    const hospital = await Hospital.findById(req.params.id);
    if (!hospital)
      return res.status(404).json({ message: "Hospital not found" });
    res.json(hospital);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const patchHospital = async (req: Request, res: Response) => {
  try {
    const hospital = await Hospital.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(hospital);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const addBranch = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, address } = req.body;
    const hospital = await Hospital.findById(id);
    if (!hospital) return res.status(404).json({ message: "Not found" });
    if (!hospital.branches) hospital.branches = [];
    hospital.branches.push({ name, address });
    await hospital.save();
    res.status(201).json(hospital);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const listBranches = async (req: Request, res: Response) => {
  try {
    const hospital = await Hospital.findById(req.params.id);
    if (!hospital) return res.status(404).json({ message: "Not found" });
    res.json(hospital.branches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteHospital = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const { id: hospitalId } = req.params;

    session.startTransaction();

    const hospital = await Hospital.findById(hospitalId).session(session);
    if (!hospital) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Hospital not found" });
    }

    // Clean up doctor references
    await DoctorProfile.updateMany(
      { hospital: hospitalId },
      { $unset: { hospital: "" } },
      { session },
    );

    await Hospital.findByIdAndDelete(hospitalId).session(session);

    await session.commitTransaction();
    session.endSession();

    res.json({ message: "Hospital deleted successfully" });
  } catch (err: any) {
    await session.abortTransaction().catch(() => {});
    session.endSession();
    console.error("deleteHospital error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const getHospitalMetadata = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const [hospital, departments, rooms, beds] = await Promise.all([
      Hospital.findById(hospitalId)
        .select(
          "unitTypes billingCategories clinicalNoteTypes clinicalNoteVisibilities ipdPharmaSettings opdFollowUpDays ipdFollowUpDays enableFollowUpExpiry",
        )
        .lean(),
      (IPDDepartment.find({ hospital: hospitalId }) as any).unscoped().lean(),
      (Room.find({ hospital: hospitalId }) as any).unscoped().lean(),
      (Bed.find({ hospital: hospitalId }) as any).unscoped().lean(),
    ]);

    if (!hospital) {
      return res.status(404).json({ message: "Hospital not found" });
    }

    // Combine unitTypes and unique room types for a comprehensive list of ward types
    const unitTypes = (hospital.unitTypes || []).map((t) =>
      t.trim().toUpperCase(),
    );

    const allRooms = rooms.map((r) => ({
      _id: r._id.toString(),
      label: (r as any).roomId || (r as any).label,
      type: r.type?.trim().toUpperCase() || "GENERAL",
    }));

    const roomTypes = [...new Set(allRooms.map((r) => r.type).filter(Boolean))];
    const wardTypes = [...new Set([...unitTypes, ...roomTypes])].sort();

    res.status(200).json({
      success: true,
      data: {
        departments: departments || [],
        rooms: allRooms,
        unitTypes: unitTypes,
        wardTypes:
          wardTypes.length > 0
            ? wardTypes
            : ["GENERAL", "ICU", "EMERGENCY", "RECOVERY", "OPERATION THEATER"],
        billingCategories: hospital.billingCategories || [
          "Consultation",
          "Procedure",
          "Pharmacy",
          "Laboratory",
          "Radiology",
          "Nursing",
          "Equipments",
          "Other",
        ],
        clinicalNoteTypes: hospital.clinicalNoteTypes || [
          "Progress Note",
          "Nursing Assessment",
          "Medication Administration Note",
          "Post-Op Monitoring",
          "Incident",
          "Shift Handover",
        ],
        clinicalNoteVisibilities: hospital.clinicalNoteVisibilities || [
          "Nurse",
          "Doctor",
          "Admin",
        ],
        ipdPharmaSettings: hospital.ipdPharmaSettings || { enabledWards: [] },
        opdFollowUpDays: hospital.opdFollowUpDays ?? 7,
        ipdFollowUpDays: hospital.ipdFollowUpDays ?? 7,
        enableFollowUpExpiry: hospital.enableFollowUpExpiry ?? true,
        minEscalationMinutes: parseInt(
          process.env.MIN_ESCALATION_MINUTES || "10",
        ),
      },
    });
  } catch (err) {
    console.error("getHospitalMetadata error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateBillingCategories = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).tenantId || (req as any).user.hospital;
    const { categories } = req.body;

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    if (!Array.isArray(categories)) {
      return res.status(400).json({ message: "Categories must be an array" });
    }

    const hospital = await Hospital.findByIdAndUpdate(
      hospitalId,
      { billingCategories: categories },
      { new: true, select: "billingCategories" },
    );

    if (!hospital) {
      return res.status(404).json({ message: "Hospital not found" });
    }

    res.status(200).json({
      success: true,
      data: hospital.billingCategories,
    });
  } catch (err) {
    console.error("updateBillingCategories error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateClinicalNoteMetadata = async (
  req: Request,
  res: Response,
) => {
  try {
    const hospitalId = (req as any).tenantId || (req as any).user.hospital;
    const { types, visibilities } = req.body;

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const updateData: any = {};
    if (Array.isArray(types)) updateData.clinicalNoteTypes = types;
    if (Array.isArray(visibilities))
      updateData.clinicalNoteVisibilities = visibilities;

    const hospital = await Hospital.findByIdAndUpdate(
      hospitalId,
      { $set: updateData },
      { new: true, select: "clinicalNoteTypes clinicalNoteVisibilities" },
    );

    if (!hospital) {
      return res.status(404).json({ message: "Hospital not found" });
    }

    res.status(200).json({
      success: true,
      data: {
        types: hospital.clinicalNoteTypes,
        visibilities: hospital.clinicalNoteVisibilities,
      },
    });
  } catch (err) {
    console.error("updateClinicalNoteMetadata error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateIPDPharmaSettings = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).tenantId || (req as any).user.hospital;
    const { enabledWards } = req.body;

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    if (enabledWards && !Array.isArray(enabledWards)) {
      return res.status(400).json({ message: "enabledWards must be an array" });
    }

    const hospital = await Hospital.findByIdAndUpdate(
      hospitalId,
      { $set: { "ipdPharmaSettings.enabledWards": enabledWards || [] } },
      { new: true, select: "ipdPharmaSettings" },
    );

    if (!hospital) {
      return res.status(404).json({ message: "Hospital not found" });
    }

    res.status(200).json({
      success: true,
      data: hospital.ipdPharmaSettings,
    });
  } catch (err) {
    console.error("updateIPDPharmaSettings error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getInfrastructureReadiness = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const [deptCount, shiftCount, roomCount, bedCount, vitalsCount] = await Promise.all([
      (IPDDepartment.countDocuments({ hospital: hospitalId }) as any).unscoped(),
      (Shift.countDocuments({ hospital: hospitalId }) as any).unscoped(),
      (Room.countDocuments({ hospital: hospitalId }) as any).unscoped(),
      (Bed.countDocuments({ hospital: hospitalId }) as any).unscoped(),
      (VitalsThresholdTemplate.countDocuments({ hospital: hospitalId }) as any).unscoped(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        isReady: deptCount > 0 && shiftCount > 0 && roomCount > 0 && bedCount > 0 && vitalsCount > 0,
        counts: {
          departments: deptCount,
          shifts: shiftCount,
          rooms: roomCount,
          beds: bedCount,
          vitalsThresholds: vitalsCount,
        }
      }
    });
  } catch (err) {
    console.error("getInfrastructureReadiness error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
