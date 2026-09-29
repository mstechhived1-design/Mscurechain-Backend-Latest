import { Request, Response } from "express";
import mongoose from "mongoose";
import BedOccupancy from "../Models/BedOccupancy.js";
import IPDAdmission from "../Models/IPDAdmission.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import StaffProfile from "../../Staff/Models/StaffProfile.js";
import { IStaffProfile } from "../../Staff/types/index.js";
import User from "../../Auth/Models/User.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Bed from "../Models/Bed.js";
import Room from "../Models/Room.js";
import IPDDepartment from "../Models/IPDDepartment.js";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import fs from "fs";
import csv from "csv-parser";
import redisService from "../../config/redis.js";

const escapeRegex = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const invalidateBedCache = async (hospitalId: any, bedId?: string) => {
  const hId = hospitalId.toString();
  const promises = [
    redisService.delPattern(`ipd:beds:${hId}*`),
    redisService.del(`nurse:stats:${hId}`),
    redisService.del(`ipd:admissions:active:${hId}`),
  ];
  if (bedId) {
    promises.push(redisService.del(`ipd:bed:details:${bedId}`));
  }
  await Promise.all(promises);
};

const resolveHospitalId = async (
  user: any,
): Promise<{ hospital: any; staffProfile: IStaffProfile | null }> => {
  let hospital = user.hospital;
  let staffProfile: IStaffProfile | null = null;
  if (!hospital || user.role === "nurse" || user.role === "staff") {
    staffProfile = await (
      StaffProfile.findOne({ user: user._id }) as any
    ).unscoped();
    if (staffProfile) {
      hospital = (staffProfile as any).hospital;
    }
  }
  return { hospital, staffProfile };
};

export const createBed = asyncHandler(async (req: Request, res: Response) => {
  const { bedId, type, floor, room, department, ward, pricePerDay, pricePerHalfDay, pricePerHour } = req.body;
  const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

  const existing = await Bed.findOne({ hospital: hospitalId, bedId });
  if (existing)
    throw new ApiError(400, "Bed ID already exists in this hospital");

  // 🚀 SYNC: Ensure unit type exists in hospital master list (Normalized to UPPERCASE)
  const normalizedType = type ? type.trim().toUpperCase() : "GENERAL";
  const hospital = await Hospital.findById(hospitalId);
  if (hospital) {
    if (!hospital.unitTypes) hospital.unitTypes = [];
    if (!hospital.unitTypes.includes(normalizedType)) {
      hospital.unitTypes.push(normalizedType);
      await hospital.save();
    }
  }

  const pDay = Number(pricePerDay) || 0;
  const pHalfDay = pricePerHalfDay !== undefined ? Number(pricePerHalfDay) : (pDay > 0 ? Math.round(pDay / 2) : 0);
  const pHour = pricePerHour !== undefined ? Number(pricePerHour) : (pDay > 0 ? Math.round(pDay / 24) : 0);

  const newBed = await Bed.create({
    bedId,
    type: normalizedType,
    floor,
    room,
    department,
    ward,
    pricePerDay: pDay,
    pricePerHalfDay: pHalfDay,
    pricePerHour: pHour,
    status: "Vacant",
    hospital: hospitalId,
  });

  await invalidateBedCache(hospitalId);

  res.status(201).json(newBed);
});

export const listBeds = asyncHandler(async (req: any, res: Response) => {
  const { status, type, department, room } = req.query;
  const { hospital, staffProfile } = await resolveHospitalId(req.user);

  if (!hospital) {
    throw new ApiError(
      400,
      "Hospital identification failed. Please contact admin.",
    );
  }

  // Cache key based on filters AND user context
  const deptAttr = staffProfile?.department;
  const deptTag = Array.isArray(deptAttr)
    ? deptAttr.join("-")
    : deptAttr || "none";
  const userContext = req.user?.role === "nurse" ? `nurse:${deptTag}` : "admin";
  const cacheKey = `ipd:beds:${hospital}:${userContext}:${status || "all"}:${type || "all"}:${department || "all"}:${room || "all"}`;

  const cachedBeds = await redisService.get(cacheKey);
  if (cachedBeds) return res.json(cachedBeds);

  const query: any = { hospital };

  // Filter by status
  if (status) {
    query.status = status;
  }

  // Filter by type (case-insensitive)
  if (type) {
    query.type = {
      $regex: new RegExp(`^${escapeRegex(String(type).trim())}$`, "i"),
    };
  }

  // Filter by room
  if (room) {
    const qRooms = String(room)
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (qRooms.length > 0) {
      query.room = {
        $in: qRooms.map((r) => new RegExp(`^${escapeRegex(r)}$`, "i")),
      };
    }
  }

  // Filter by department/ward
  if (department) {
    const qDepts = String(department)
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    if (qDepts.length > 0) {
      const orFilters = qDepts
        .map((d) => {
          const regex = new RegExp(`^${escapeRegex(d)}$`, "i");
          return [
            { department: { $regex: regex } },
            { ward: { $regex: regex } },
            { type: { $regex: regex } },
          ];
        })
        .flat();
      query.$or = orFilters;
    }
  }

  // Nurse permission filtering
  const userRole = String(req.user?.role || "").toLowerCase();
  if (userRole === "nurse") {
    const rawDept = staffProfile?.department;
    const rawRooms = staffProfile?.assignedRoom;

    if (
      (!rawDept || (Array.isArray(rawDept) && rawDept.length === 0)) &&
      (!rawRooms || (Array.isArray(rawRooms) && rawRooms.length === 0))
    ) {
      return res.json([]);
    }

    const pDepts = Array.isArray(rawDept)
      ? rawDept.map((d) => d.trim())
      : rawDept
        ? [String(rawDept).trim()]
        : [];
    const pRooms = Array.isArray(rawRooms)
      ? rawRooms.map((r) => r.trim())
      : rawRooms
        ? [String(rawRooms).trim()]
        : [];

    const nursePermissionFilters: any[] = [];

    if (pDepts.length > 0) {
      const deptFilters = pDepts.map((d) => {
        const regex = new RegExp(`^${escapeRegex(d)}$`, "i");
        return {
          $or: [
            { department: { $regex: regex } },
            { ward: { $regex: regex } },
            { type: { $regex: regex } },
          ],
        };
      });
      nursePermissionFilters.push({ $or: deptFilters });
    }

    if (pRooms.length > 0) {
      const roomFilters = pRooms.map((r) => ({
        room: { $regex: new RegExp(`^${escapeRegex(r)}$`, "i") },
      }));
      nursePermissionFilters.push({ $or: roomFilters });
    }

    if (nursePermissionFilters.length > 0) {
      if (query.$and) {
        query.$and.push(...nursePermissionFilters);
      } else {
        query.$and = nursePermissionFilters;
      }
    }
  }

  const beds = await Bed.find(query).lean();

  const bedsWithOccupancy = await Promise.all(
    beds.map(async (bed: any) => {
      if (bed.status === "Occupied") {
        try {
          const occupancy = await BedOccupancy.findOne({
            bed: bed._id,
            $or: [{ endDate: { $exists: false } }, { endDate: null }],
          })
            .sort({ startDate: -1 })
            .populate({
              path: "admission",
              populate: { path: "patient", select: "name" },
            });

          if (occupancy?.admission && typeof occupancy.admission === "object") {
            const adm = occupancy.admission as any;
            return {
              ...(bed.toObject ? bed.toObject() : bed),
              currentOccupancy: {
                patientName: adm.patient?.name || "Unknown",
                admissionId: adm.admissionId,
                admissionDate: adm.admissionDate,
                lastVitalsRecordedAt: adm.vitals?.lastVitalsRecordedAt,
                condition: adm.vitals?.status || "Stable",
              },
            };
          }
        } catch (err) {
          console.error(`Error mapping occupancy for bed ${bed._id}:`, err);
        }

        // 🛠 SYNC: If bed is status='Occupied' but NO active occupancy found, it's a data mismatch.
        // Recover by marking it as Cleaning/Vacant and returning null occupancy.
        console.warn(
          `[DATA CONSISTENCY] Bed ${bed.bedId} is marked Occupied but has no active BedOccupancy. Auto-recovering status to Cleaning.`,
        );
        await Bed.updateOne({ _id: bed._id }, { $set: { status: "Cleaning" } });
        bed.status = "Cleaning"; // Update the object in memory for the response
      }

      return {
        ...(bed.toObject ? bed.toObject() : bed),
        currentOccupancy: null,
      };
    }),
  );

  await redisService.set(cacheKey, bedsWithOccupancy, 300);
  res.json(bedsWithOccupancy);
});

export const getBedDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      throw new ApiError(400, "Invalid Bed ID format");

    const { hospital } = await resolveHospitalId((req as any).user);
    if (!hospital) throw new ApiError(401, "Hospital context required");

    const cacheKey = `ipd:bed:details:${id}`;
    const cachedData = await redisService.get(cacheKey);
    if (cachedData) return res.json(cachedData);

    const bed = await Bed.findOne({ _id: id, hospital }).lean();
    if (!bed) throw new ApiError(404, "Bed not found");

    let occupancyDetails: any = null;

    if (bed.status === "Occupied") {
      const active = await BedOccupancy.findOne({
        bed: id,
        endDate: { $exists: false },
      })
        .sort({ startDate: -1 })
        .populate({
          path: "admission",
          populate: [
            { path: "patient", select: "name mobile" },
            {
              path: "primaryDoctor",
              populate: { path: "user", select: "name" },
            },
          ],
        });

      if (active?.admission) {
        try {
          const adm = active.admission as any;
          let patientId = adm.patient?._id || adm.patient;

          if (!patientId && adm._id) {
            const raw = await IPDAdmission.findById(adm._id).select("patient");
            patientId = raw?.patient;
          }

          const profile = patientId
            ? await PatientProfile.findOne({
              $or: [{ user: patientId }, { _id: patientId }],
            })
            : null;

          let resolvedPatient = adm.patient;
          if (profile && (!resolvedPatient || !resolvedPatient.name)) {
            const user = await User.findById(profile.user).select(
              "name mobile",
            );
            if (user)
              resolvedPatient = {
                _id: user._id,
                name: user.name,
                mobile: user.mobile,
              };
          }

          // Billing Calculation (Pro-rated for short occupancies)
          const startDate = new Date(active.startDate);
          let today = new Date();
          if (adm?.isBillLocked && adm?.billLockedAt) {
            today = new Date(adm.billLockedAt);
          } else if (adm?.status === "Discharged") {
            today = adm?.updatedAt ? new Date(adm.updatedAt) : new Date();
          }
          const diffMs = Math.max(0, today.getTime() - startDate.getTime());
          const diffHours = diffMs / (1000 * 60 * 60);
          const dailyRate = active.dailyRateAtTime || bed.pricePerDay || 0;
          const halfDayRate = active.halfDayRateAtTime !== undefined && active.halfDayRateAtTime > 0 ? active.halfDayRateAtTime : (bed.pricePerHalfDay !== undefined && bed.pricePerHalfDay > 0 ? bed.pricePerHalfDay : Math.round(dailyRate / 2));
          const hourlyRate = (active.hourlyRateAtTime !== undefined && active.hourlyRateAtTime > 0) ? active.hourlyRateAtTime : (bed.pricePerHour !== undefined && bed.pricePerHour > 0 ? bed.pricePerHour : (dailyRate > 0 ? dailyRate / 24 : 0));

          let diffDays: number;
          let bedCharge: number;

          if (diffHours < 1) {
            const chargeableHours = Math.max(1, Math.ceil(diffHours));
            bedCharge = Math.round(chargeableHours * hourlyRate);
            diffDays = parseFloat((diffHours / 24).toFixed(2)) || 0.04;
          } else {
            const fullDays = Math.floor(diffHours / 24);
            const remainderHours = diffHours % 24;
            const ceilRemainingHours = Math.ceil(remainderHours);
            if (ceilRemainingHours === 24) {
              bedCharge = (fullDays + 1) * dailyRate;
              diffDays = fullDays + 1;
            } else {
              const remainderCharge = Math.min(dailyRate, Math.round(ceilRemainingHours * hourlyRate));
              bedCharge = (fullDays * dailyRate) + remainderCharge;
              diffDays = parseFloat((diffHours / 24).toFixed(2));
            }
          }

          occupancyDetails = {
            admissionId: adm.admissionId || "N/A",
            patient: resolvedPatient || { name: "Unknown Patient" },
            doctor: adm.primaryDoctor || null,
            admissionDate: adm.admissionDate || active.startDate,
            isBillLocked: adm.isBillLocked,
            billLockedAt: adm.billLockedAt,
            vitals:
              adm.vitals &&
                typeof adm.vitals === "object" &&
                Object.keys(adm.vitals).length > 0
                ? { ...adm.vitals, status: adm.vitals.status || "Stable" }
                : profile
                  ? {
                    height: profile.height,
                    weight: profile.weight,
                    bloodPressure: profile.bloodPressure,
                    temperature: profile.temperature,
                    pulse: profile.pulse,
                    spO2: profile.spO2,
                    glucose: profile.glucose,
                    status: profile.condition || "Stable",
                  }
                  : null,
            medications: profile?.medications || "None",
            diet: adm.diet || "Standard",
            clinicalNotes: adm.clinicalNotes || "No notes available",
            lastVitalsRecordedAt: adm.vitals?.lastVitalsRecordedAt,
            condition: adm.vitals?.status || "Stable",
            billing: {
              daysOccupied: diffDays,
              bedCharge: bedCharge,
              totalAmount: adm.totalBilledAmount || bedCharge, // This will be expanded later
              advancePaid: adm.advancePaid || 0,
              balance:
                (adm.totalBilledAmount || bedCharge) - (adm.advancePaid || 0),
              status: adm.paymentStatus || "Pending",
              isBillLocked: adm.isBillLocked,
              billLockedAt: adm.billLockedAt,
            },
            bedHistory: (await BedOccupancy.find({ admission: adm._id })
              .sort({ startDate: 1 })
              .populate("bed")
              .lean()).map((occ: any) => ({
                bedId: occ.bed?.bedId || "Unknown Bed",
                room: occ.bed?.room || "N/A",
                type: occ.bed?.type || "N/A",
                startDate: occ.startDate,
                endDate: occ.endDate,
                pricePerDay: occ.dailyRateAtTime || occ.bed?.pricePerDay || 0,
                pricePerHalfDay: occ.halfDayRateAtTime !== undefined ? occ.halfDayRateAtTime : (occ.bed?.pricePerHalfDay !== undefined ? occ.bed.pricePerHalfDay : Math.round((occ.dailyRateAtTime || occ.bed?.pricePerDay || 0) / 2)),
                pricePerHour: occ.hourlyRateAtTime !== undefined ? occ.hourlyRateAtTime : (occ.bed?.pricePerHour !== undefined ? occ.bed.pricePerHour : Math.round((occ.dailyRateAtTime || occ.bed?.pricePerDay || 0) / 24)),
              }))
          };
        } catch (err: any) {
          console.error("Critical Error in IPD Occupancy Processing:", err);
          occupancyDetails = {
            status: "Error",
            message: "Processing failed: " + err.message,
          };
        }
      } else {
        // 🛠 SYNC: If bed is status='Occupied' but NO active occupancy found, it's a data mismatch.
        // Recover by marking it as Cleaning.
        console.warn(
          `[DATA CONSISTENCY] getBedDetails: Bed ${bed.bedId} is marked Occupied but has no active BedOccupancy. Auto-recovering status to Cleaning.`,
        );
        await Bed.updateOne({ _id: bed._id }, { $set: { status: "Cleaning" } });
        bed.status = "Cleaning";
      }
    }

    const response = { bed, occupancyDetails, success: true };
    await redisService.set(cacheKey, response, 300);
    res.json(response);
  },
);

export const updateBedStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

    const bed = await Bed.findOneAndUpdate(
      { _id: id, hospital: hospitalId },
      { $set: { status } },
      { new: true },
    );

    if (!bed) throw new ApiError(404, "Bed not found");

    await invalidateBedCache(hospitalId, id);

    res.json(bed);
  },
);

export const updateBed = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const items = req.body;
  const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

  const updateFields: any = { ...items };

  // ✅ Check: if bedId is being changed, ensure it doesn't clash with another bed in this hospital
  if (items.bedId) {
    const clash = await Bed.findOne({
      hospital: hospitalId,
      bedId: items.bedId,
      _id: { $ne: id },
    });
    if (clash)
      throw new ApiError(
        400,
        `Bed ID "${items.bedId}" already exists in this hospital`,
      );
  }

  // Normalize type if provided
  if (items.type) {
    const normalizedType = items.type.trim().toUpperCase();
    updateFields.type = normalizedType;

    const hospitalDoc = await Hospital.findById(hospitalId);
    if (hospitalDoc) {
      if (!hospitalDoc.unitTypes) hospitalDoc.unitTypes = [];
      if (!hospitalDoc.unitTypes.includes(normalizedType)) {
        hospitalDoc.unitTypes.push(normalizedType);
        await hospitalDoc.save();
      }
    }
  }

  if (items.pricePerDay !== undefined) {
    updateFields.pricePerDay = Number(items.pricePerDay) || 0;
    if (items.pricePerHalfDay === undefined) {
      updateFields.pricePerHalfDay = updateFields.pricePerDay > 0 ? Math.round(updateFields.pricePerDay / 2) : 0;
    }
    if (items.pricePerHour === undefined) {
      updateFields.pricePerHour = updateFields.pricePerDay > 0 ? Math.round(updateFields.pricePerDay / 24) : 0;
    }
  }
  if (items.pricePerHalfDay !== undefined) updateFields.pricePerHalfDay = Number(items.pricePerHalfDay) || 0;
  if (items.pricePerHour !== undefined) updateFields.pricePerHour = Number(items.pricePerHour) || 0;

  const bed = await Bed.findOneAndUpdate(
    { _id: id, hospital: hospitalId },
    { $set: updateFields },
    { new: true },
  );

  if (!bed) throw new ApiError(404, "Bed not found");

  await invalidateBedCache(hospitalId, id);

  res.json(bed);
});

export const deleteBed = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

  const bed = await Bed.findOneAndDelete({ _id: id, hospital: hospitalId });
  if (!bed)
    throw new ApiError(
      404,
      "Bed decommissioned, but was not found in database.",
    );

  await invalidateBedCache(hospitalId, id);

  res.json({ message: "Bed decommissioned successfully" });
});

// ==================== Room Management ====================

export const createRoom = asyncHandler(async (req: Request, res: Response) => {
  const { label, type, floor, department } = req.body;
  if (!label || !type)
    throw new ApiError(400, "Room label and type are required");
  const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

  const existing = await Room.findOne({ hospital: hospitalId, roomId: label });
  if (existing)
    throw new ApiError(400, "Room label already exists in this hospital");

  const normalizedType = type.trim().toUpperCase();

  const hospital = await Hospital.findById(hospitalId);
  if (hospital) {
    if (!hospital.unitTypes) hospital.unitTypes = [];
    if (!hospital.unitTypes.includes(normalizedType)) {
      hospital.unitTypes.push(normalizedType);
      await hospital.save();
    }
  }

  const newRoom = await Room.create({
    roomId: label, // Map label to roomId
    type: normalizedType,
    floor: floor || "1",
    department: department || "",
    hospital: hospitalId,
  });

  res.status(201).json({ ...newRoom.toObject(), label: newRoom.roomId });
});

export const listRooms = asyncHandler(async (req: Request, res: Response) => {
  const { hospital: hospitalId } = await resolveHospitalId((req as any).user);
  const { type } = req.query;

  const query: any = { hospital: hospitalId, isActive: true };
  if (type && type !== "all") {
    query.type = String(type).trim().toUpperCase();
  }

  const rooms = await Room.find(query).lean();
  res.json(rooms.map((r) => ({ ...r, label: r.roomId }))); // Map back for frontend compatibility
});

export const deleteRoom = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

  const room = await Room.findOneAndDelete({ _id: id, hospital: hospitalId });
  if (!room) throw new ApiError(404, "Room not found");

  res.json({ message: "Room deleted successfully" });
});

export const updateRoom = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { label, type, floor, department } = req.body;
  const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

  // ✅ Check: if label (roomId) is being changed, ensure it doesn't clash with another room in this hospital
  if (label) {
    const clash = await Room.findOne({
      hospital: hospitalId,
      roomId: label.trim(),
      _id: { $ne: id },
    });
    if (clash)
      throw new ApiError(
        400,
        `Room label "${label.trim()}" already exists in this hospital`,
      );
  }

  const normalizedType = type ? type.trim().toUpperCase() : undefined;

  const updateFields: any = {};
  if (label) updateFields.roomId = label.trim();
  if (normalizedType) updateFields.type = normalizedType;
  if (floor) updateFields.floor = floor;
  if (department !== undefined) updateFields.department = department;

  const room = await Room.findOneAndUpdate(
    { _id: id, hospital: hospitalId },
    { $set: updateFields },
    { new: true },
  );

  if (!room) throw new ApiError(404, "Room not found");

  // 🚀 SYNC: Ensure unit type exists in hospital master list (Normalized to UPPERCASE)
  if (normalizedType) {
    const hospital = await Hospital.findById(hospitalId);
    if (
      hospital &&
      hospital.unitTypes &&
      !hospital.unitTypes.includes(normalizedType)
    ) {
      hospital.unitTypes.push(normalizedType);
      await hospital.save();
    }
  }

  res.json({ ...room.toObject(), label: room.roomId });
});

// ==================== Unit Type Management ====================

export const listUnitTypes = asyncHandler(
  async (req: Request, res: Response) => {
    const { hospital: hospitalId } = await resolveHospitalId((req as any).user);
    const hospital = await Hospital.findById(hospitalId).select("unitTypes");
    if (!hospital) throw new ApiError(404, "Hospital not found");

    // ✅ NORMALIZE: Deduplicate case-insensitively — "General Ward" and "GENERAL WARD" → "GENERAL WARD"
    // This also self-heals any dirty data stored before normalization was enforced
    const rawTypes = hospital.unitTypes || [];
    const seen = new Map<string, string>(); // key=UPPERCASE → value=stored string
    for (const t of rawTypes) {
      const upper = t.trim().toUpperCase();
      if (!seen.has(upper)) {
        seen.set(upper, upper); // always store as UPPERCASE
      }
    }
    const types = Array.from(seen.values()).sort();

    // 🔧 SELF-HEAL: If dirty data existed, persist the cleaned list back to DB
    if (
      rawTypes.length !== types.length ||
      rawTypes.some((t, i) => t !== types[i])
    ) {
      await Hospital.findByIdAndUpdate(hospitalId, {
        $set: { unitTypes: types },
      });
    }

    res.json(types);
  },
);

export const addUnitType = asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.body;
  if (!type) throw new ApiError(400, "Type is required");
  const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw new ApiError(404, "Hospital not found");

  const normalizedType = type.trim().toUpperCase();
  if (!hospital.unitTypes) hospital.unitTypes = [];

  // ✅ Case-insensitive duplicate check — "General Ward" == "GENERAL WARD"
  const alreadyExists = hospital.unitTypes.some(
    (t) => t.trim().toUpperCase() === normalizedType,
  );
  if (alreadyExists)
    throw new ApiError(
      400,
      `Unit type already exists (as "${hospital.unitTypes.find((t) => t.trim().toUpperCase() === normalizedType)}")`,
    );

  hospital.unitTypes.push(normalizedType);
  await hospital.save();

  res.status(201).json(hospital.unitTypes);
});

export const updateUnitType = asyncHandler(
  async (req: Request, res: Response) => {
    let { oldType, newType } = req.body;
    if (!oldType || !newType)
      throw new ApiError(400, "Old and new types are required");

    oldType = oldType.trim().toUpperCase();
    newType = newType.trim().toUpperCase();

    const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) throw new ApiError(404, "Hospital not found");

    if (!hospital.unitTypes) hospital.unitTypes = [];
    const index = hospital.unitTypes.indexOf(oldType);
    if (index === -1) throw new ApiError(404, "Unit type not found");

    hospital.unitTypes[index] = newType;
    await hospital.save();

    // Update all standalone rooms
    await Room.updateMany(
      { hospital: hospitalId, type: oldType },
      { $set: { type: newType } },
    );

    // Update all standalone beds
    await Bed.updateMany(
      { hospital: hospitalId, type: oldType },
      { $set: { type: newType } },
    );

    await invalidateBedCache(hospitalId.toString());

    res.json(hospital.unitTypes);
  },
);

export const deleteUnitType = asyncHandler(
  async (req: Request, res: Response) => {
    const { type } = req.params;
    const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) throw new ApiError(404, "Hospital not found");

    if (!hospital.unitTypes) hospital.unitTypes = [];
    const normalizedType = type.trim().toUpperCase();
    hospital.unitTypes = hospital.unitTypes.filter((t) => t !== normalizedType);

    await hospital.save();

    res.json(hospital.unitTypes);
  },
);

// ==================== Department Management ====================

export const createIPDDepartment = asyncHandler(
  async (req: Request, res: Response) => {
    const { name, code, description } = req.body;
    if (!name || !code)
      throw new ApiError(400, "Department name and code are required");
    const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

    const existing = await IPDDepartment.findOne({
      hospital: hospitalId,
      $or: [{ name }, { code }],
    });
    if (existing) {
      const conflictField =
        existing.name === name ? `name "${name}"` : `code "${code}"`;
      throw new ApiError(
        400,
        `Department ${conflictField} already exists in this hospital`,
      );
    }

    const department = await IPDDepartment.create({
      name,
      code,
      description,
      hospital: hospitalId,
      isActive: true,
    });

    res.status(201).json(department);
  },
);

export const listIPDDepartments = asyncHandler(
  async (req: Request, res: Response) => {
    const { hospital: hospitalId } = await resolveHospitalId((req as any).user);
    const departments = await IPDDepartment.find({
      hospital: hospitalId,
      isActive: true,
    });
    res.json(departments);
  },
);

export const deleteIPDDepartment = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

    const department = await IPDDepartment.findOneAndDelete({
      _id: id,
      hospital: hospitalId,
    });
    if (!department) throw new ApiError(404, "Department not found");

    res.json({ message: "Department deleted successfully" });
  },
);

export const updateIPDDepartment = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, code, description, isActive } = req.body;
    const { hospital: hospitalId } = await resolveHospitalId((req as any).user);

    // ✅ Check: ensure new name/code don't clash with ANOTHER department in this hospital
    if (name || code) {
      const orConditions: any[] = [];
      if (name) orConditions.push({ name });
      if (code) orConditions.push({ code });

      const clash = await IPDDepartment.findOne({
        hospital: hospitalId,
        _id: { $ne: id },
        $or: orConditions,
      });

      if (clash) {
        const conflictField =
          clash.name === name ? `name "${name}"` : `code "${code}"`;
        throw new ApiError(
          400,
          `Department ${conflictField} already exists in this hospital`,
        );
      }
    }

    const updateData: any = { description, isActive };
    if (name) updateData.name = name;
    if (code !== undefined) updateData.code = code;

    const department = await IPDDepartment.findOneAndUpdate(
      { _id: id, hospital: hospitalId },
      { $set: updateData },
      { new: true },
    );

    if (!department) throw new ApiError(404, "Department not found");
    res.json(department);
  },
);

// ==================== Bulk Import (Generic) ====================

export const importAssets = asyncHandler(async (req: any, res: Response) => {
  if (!req.file) throw new ApiError(400, "Please upload a CSV file");
  const { type } = req.params; // 'beds', 'rooms', or 'departments'
  const { hospital: hospitalId } = await resolveHospitalId((req as any).user);
  const results: any[] = [];
  const errors: any[] = [];
  let updateCount = 0;
  let createCount = 0;

  const fileStream = fs.createReadStream(req.file.path);

  fileStream
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", async () => {
      try {
        const hospitalDoc = await Hospital.findById(hospitalId);
        if (!hospitalDoc) throw new ApiError(404, "Hospital not found");

        for (const row of results) {
          try {
            if (type === "beds") {
              let {
                bedId,
                type: bedType,
                floor,
                room,
                department,
                ward,
                pricePerDay,
              } = row;
              if (!bedId || !bedType || !floor || !room) {
                errors.push({ row, error: "Missing required fields" });
                continue;
              }
              const normalizedType = bedType.trim().toUpperCase();

              const updated = await Bed.findOneAndUpdate(
                { hospital: hospitalId, bedId },
                {
                  $set: {
                    type: normalizedType,
                    floor,
                    room,
                    department,
                    ward,
                    pricePerDay: Number(pricePerDay) || 0,
                  },
                },
                { upsert: true, new: false },
              );

              if (updated) updateCount++;
              else createCount++;
            } else if (type === "rooms") {
              let { label, type: roomType, floor, department } = row;
              if (!label || !roomType) {
                errors.push({
                  row,
                  error: "Missing required fields (label, type)",
                });
                continue;
              }

              const trimmedLabel = label.trim();
              const normalizedType = roomType.trim().toUpperCase();

              const updated = await Room.findOneAndUpdate(
                { hospital: hospitalId, roomId: trimmedLabel },
                {
                  $set: {
                    type: normalizedType,
                    floor: floor || "1",
                    department: department || "",
                    isActive: true,
                  },
                },
                { upsert: true, new: false },
              );

              if (updated) {
                updateCount++;
                // Sync beds if room type changed
                if (updated.type !== normalizedType) {
                  await Bed.updateMany(
                    { hospital: hospitalId, room: trimmedLabel },
                    { $set: { type: normalizedType } },
                  );
                }
              } else {
                createCount++;
              }
            } else if (type === "departments") {
              const { name, code, description } = row;
              if (!name || !code) {
                errors.push({
                  row,
                  error: "Missing required fields (name, code)",
                });
                continue;
              }

              const updated = await IPDDepartment.findOneAndUpdate(
                { hospital: hospitalId, $or: [{ name }, { code }] },
                {
                  $set: { name, code, description, isActive: true },
                },
                { upsert: true, new: false },
              );

              if (updated) updateCount++;
              else createCount++;
            }
          } catch (rowErr: any) {
            errors.push({ row, error: rowErr.message });
          }
        }

        // 🚀 SMART SYNC: Update hospital unitTypes from imported data
        if (type === "rooms" || type === "beds") {
          const importedTypes = new Set<string>();
          results.forEach((row) => {
            if (row.type) importedTypes.add(row.type.trim().toUpperCase());
          });

          if (importedTypes.size > 0) {
            const existingMap = new Map<string, string>();
            (hospitalDoc.unitTypes || []).forEach((t) => {
              existingMap.set(t.trim().toUpperCase(), t.trim());
            });
            let changed = false;
            importedTypes.forEach((normalized) => {
              if (!existingMap.has(normalized)) {
                existingMap.set(normalized, normalized);
                changed = true;
              }
            });

            if (changed) {
              hospitalDoc.unitTypes = Array.from(existingMap.values()).sort();
              await hospitalDoc.save();
            }
          }
        }

        if (fs.existsSync(req.file!.path)) fs.unlinkSync(req.file!.path);

        const hId = hospitalId.toString();
        await invalidateBedCache(hId);

        res.status(201).json({
          message: `Import completed. ${createCount} new entries created, ${updateCount} entries updated.`,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (err: any) {
        if (req.file && fs.existsSync(req.file.path))
          fs.unlinkSync(req.file.path);
        res.status(500).json({ message: "Import failed", error: err.message });
      }
    });
});

/**
 * Bulk import assets from JSON data (supporting preview/edit flow)
 */
export const importAssetsJSON = asyncHandler(async (req: any, res: Response) => {
  const { type } = req.params; // 'beds', 'rooms', or 'departments'
  const { data } = req.body;

  if (!data || !Array.isArray(data)) throw new ApiError(400, "Invalid data format");

  const { hospital: hospitalId } = await resolveHospitalId((req as any).user);
  if (!hospitalId) throw new ApiError(401, "Hospital context required");

  let updateCount = 0;
  let createCount = 0;
  const errors: any[] = [];

  const hospitalDoc = await Hospital.findById(hospitalId);
  if (!hospitalDoc) throw new ApiError(404, "Hospital not found");

  for (const row of data) {
    try {
      if (type === "beds") {
        let { bedId, type: bedType, floor, room, department, ward, pricePerDay, pricePerHalfDay, pricePerHour } = row;
        if (!bedId || !bedType || !floor || !room) {
          errors.push({ row, error: "Missing required fields (bedId, type, floor, room)" });
          continue;
        }
        const normalizedType = bedType.trim().toUpperCase();
        const pDay = Number(pricePerDay) || 0;
        const pHalfDay = pricePerHalfDay !== undefined ? Number(pricePerHalfDay) : (pDay > 0 ? Math.round(pDay / 2) : 0);
        const pHour = pricePerHour !== undefined ? Number(pricePerHour) : (pDay > 0 ? Math.round(pDay / 24) : 0);

        const updated = await Bed.findOneAndUpdate(
          { hospital: hospitalId, bedId },
          {
            $set: {
              type: normalizedType,
              floor,
              room,
              department,
              ward,
              pricePerDay: pDay,
              pricePerHalfDay: pHalfDay,
              pricePerHour: pHour,
            },
          },
          { upsert: true, new: false },
        );

        if (updated) updateCount++;
        else createCount++;
      } else if (type === "rooms") {
        let { label, type: roomType, floor, department } = row;
        if (!label || !roomType) {
          errors.push({ row, error: "Missing required fields (label, type)" });
          continue;
        }

        const trimmedLabel = label.trim();
        const normalizedType = roomType.trim().toUpperCase();

        const updated = await Room.findOneAndUpdate(
          { hospital: hospitalId, roomId: trimmedLabel },
          {
            $set: {
              type: normalizedType,
              floor: floor || "1",
              department: department || "",
              isActive: true,
            },
          },
          { upsert: true, new: false },
        );

        if (updated) {
          updateCount++;
          if (updated.type !== normalizedType) {
            await Bed.updateMany(
              { hospital: hospitalId, room: trimmedLabel },
              { $set: { type: normalizedType } },
            );
          }
        } else {
          createCount++;
        }
      } else if (type === "departments") {
        const { name, code, description } = row;
        if (!name || !code) {
          errors.push({ row, error: "Missing required fields (name, code)" });
          continue;
        }

        const updated = await IPDDepartment.findOneAndUpdate(
          { hospital: hospitalId, $or: [{ name }, { code }] },
          {
            $set: { name, code, description, isActive: true },
          },
          { upsert: true, new: false },
        );

        if (updated) updateCount++;
        else createCount++;
      }
    } catch (rowErr: any) {
      errors.push({ row, error: rowErr.message });
    }
  }

  // Sync unit types
  if (type === "rooms" || type === "beds") {
    const importedTypes = new Set<string>();
    data.forEach((row: any) => {
      const t = row.type || row.bedType || row.roomType;
      if (t) importedTypes.add(t.trim().toUpperCase());
    });

    if (importedTypes.size > 0) {
      const existingMap = new Map<string, string>();
      (hospitalDoc.unitTypes || []).forEach((t) => {
        existingMap.set(t.trim().toUpperCase(), t.trim());
      });
      let changed = false;
      importedTypes.forEach((normalized) => {
        if (!existingMap.has(normalized)) {
          existingMap.set(normalized, normalized);
          changed = true;
        }
      });

      if (changed) {
        hospitalDoc.unitTypes = Array.from(existingMap.values()).sort();
        await hospitalDoc.save();
      }
    }
  }

  const hId = hospitalId.toString();
  await invalidateBedCache(hId);

  res.status(201).json({
    message: `Import completed. ${createCount} new entries created, ${updateCount} entries updated.`,
    addedCount: createCount + updateCount, // For frontend consistency
    errorCount: errors.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});

