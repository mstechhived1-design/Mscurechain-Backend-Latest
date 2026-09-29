import { Response } from "express";
import mongoose from "mongoose";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import MasterDoctorLeave from "../Models/MasterDoctorLeave.js";
import Leave from "../../Leave/Models/Leave.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import { MasterHelpdeskRequest } from "../types/index.js";

// ── Helper ────────────────────────────────────────────────────────────────────
const resolveHospital = (req: MasterHelpdeskRequest) => {
  const hospital = req.hospitalId || (req.user as any)?.hospital;
  if (!hospital) throw new ApiError(400, "Hospital context required");
  return hospital.toString();
};

/**
 * Resolve the User._id for a given doctorId.
 * Accepts either a DoctorProfile._id or a User._id.
 */
const resolveDoctorUserId = async (doctorId: string) => {
  if (!mongoose.Types.ObjectId.isValid(doctorId)) return null;
  const profile = await (DoctorProfile.findById(doctorId) as any).unscoped()
    ?? await (DoctorProfile.findOne({ user: new mongoose.Types.ObjectId(doctorId) }) as any).unscoped();
  return profile ? profile.user : new mongoose.Types.ObjectId(doctorId);
};

// ── Create (stores in MasterDoctorLeave) ─────────────────────────────────────
export const createDoctorLeave = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const { doctorId, startDate, endDate, reason, leaveType, emergencyDetails, agreedToTerms } = req.body;

    if (!doctorId || !startDate || !endDate || !reason || !leaveType)
      throw new ApiError(400, "doctorId, startDate, endDate, reason and leaveType are required");

    if (new Date(startDate) > new Date(endDate))
      throw new ApiError(400, "End date must be on or after start date");

    const hospitalId = resolveHospital(req);

    const profile = await (DoctorProfile.findById(doctorId) as any).unscoped()
      ?? await (DoctorProfile.findOne({ user: doctorId, hospital: hospitalId }) as any).unscoped();
    if (!profile) throw new ApiError(404, "Doctor profile not found");

    // Count existing active appointments in this range
    const appointmentCount = await (Appointment.countDocuments({
      doctor: profile._id,
      date: { $gte: new Date(startDate), $lte: new Date(endDate) },
      status: { $in: ["Booked", "booked", "pending", "confirmed", "waiting"] },
    }) as any).unscoped();

    // Restriction Logic: If appointments > 3, must be Emergency + Detailed + Agreed
    if (appointmentCount > 3) {
      if (leaveType !== "emergency") {
        throw new ApiError(400, "With more than 3 appointments, only Emergency Leave is allowed.");
      }
      if (!emergencyDetails) {
        throw new ApiError(400, "Please provide 'emergencyDetails' stating the problem and why you won't be present.");
      }
      if (!agreedToTerms) {
        throw new ApiError(400, "You must agree to the terms and conditions regarding refunds for existing appointments.");
      }
    }

    const leave = await MasterDoctorLeave.create({
      doctor: profile.user,
      doctorProfile: profile._id,
      hospital: hospitalId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      reason,
      leaveType,
      emergencyDetails,
      agreedToTerms: !!agreedToTerms,
      appointmentsFoundAtRequest: appointmentCount,
      status: "pending",
    });

    res.status(201).json({ message: "Leave request created successfully", leave });
  },
);

// ── Get leaves for a specific doctor (merges old Leave + new MasterDoctorLeave) ──
export const getLeavesByDoctor = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const { doctorId } = req.params;
    const hospitalId = resolveHospital(req);

    const userObjId = await resolveDoctorUserId(doctorId);
    if (!userObjId) throw new ApiError(400, "Invalid doctorId");

    // 1. Fetch from existing Leave model (doctor's own requests)
    const oldLeaves = await (Leave.find({
      requester: userObjId,
      hospital: hospitalId,
    }) as any)
      .unscoped()
      .populate("requester", "name mobile email")
      .sort({ createdAt: -1 });

    // 2. Fetch from new MasterDoctorLeave model (created by MasterHelpdesk)
    const masterLeaves = await MasterDoctorLeave.find({
      doctor: userObjId,
      hospital: hospitalId,
    })
      .populate("doctor", "name mobile email")
      .populate("reviewedBy", "name role")
      .sort({ createdAt: -1 });

    console.log(`[getLeavesByDoctor] masterLeaves count: ${masterLeaves.length}`);

    // 3. Normalise old Leave records to match frontend shape
    const normalisedOld = oldLeaves.map((l: any) => ({
      _id: l._id,
      doctor: l.requester,   // old model uses `requester`
      hospital: l.hospital,
      startDate: l.startDate,
      endDate: l.endDate,
      reason: l.reason,
      leaveType: l.leaveType,
      status: l.status,
      reviewedBy: null,
      reviewNote: null,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      _source: "leave",       // tag so frontend/delete knows which model
    }));

    const normalisedMaster = masterLeaves.map((l: any) => ({
      ...l.toObject(),
      _source: "masterLeave",
    }));

    // 4. Merge & sort newest first
    const leaves = [...normalisedOld, ...normalisedMaster].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    res.json({ leaves });
  },
);

// ── Get all leaves for hospital (list view) ───────────────────────────────────
export const getDoctorLeaves = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const hospitalId = resolveHospital(req);
    const { status, page = 1, limit = 20 } = req.query as any;

    const baseQuery: any = { hospital: hospitalId };
    if (status && ["pending", "approved", "rejected"].includes(status)) baseQuery.status = status;

    const [oldLeaves, masterLeaves] = await Promise.all([
      (Leave.find({ ...baseQuery }) as any)
        .unscoped()
        .populate("requester", "name mobile email")
        .sort({ createdAt: -1 }),
      MasterDoctorLeave.find(baseQuery)
        .populate("doctor", "name mobile email")
        .populate("reviewedBy", "name role")
        .sort({ createdAt: -1 }),
    ]);

    const normOld = oldLeaves.map((l: any) => ({ ...l.toObject(), doctor: l.requester, _source: "leave" }));
    const normMaster = masterLeaves.map((l: any) => ({ ...l.toObject(), _source: "masterLeave" }));

    const all = [...normOld, ...normMaster].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const start = (Number(page) - 1) * Number(limit);
    const paginated = all.slice(start, start + Number(limit));

    res.json({ leaves: paginated, pagination: { total: all.length, page: Number(page), pages: Math.ceil(all.length / Number(limit)) } });
  },
);

// ── Get single leave (checks both models) ─────────────────────────────────────
export const getDoctorLeaveById = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const { leaveId } = req.params;
    const hospitalId = resolveHospital(req);

    let leave: any = await MasterDoctorLeave.findOne({ _id: leaveId, hospital: hospitalId })
      .populate("doctor", "name mobile email").populate("reviewedBy", "name role");

    if (!leave) {
      const old = await (Leave.findOne({ _id: leaveId, hospital: hospitalId }) as any)
        .unscoped().populate("requester", "name mobile email");
      if (old) leave = { ...old.toObject(), doctor: old.requester, _source: "leave" };
    }

    if (!leave) throw new ApiError(404, "Leave request not found");
    res.json(leave);
  },
);

// ── Update leave status ────────────────────────────────────────────────────────
export const updateDoctorLeaveStatus = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const { leaveId } = req.params;
    const { status, reviewNote } = req.body;
    const hospitalId = resolveHospital(req);
    const reviewerId = (req.user as any)._id;

    if (!["approved", "rejected"].includes(status))
      throw new ApiError(400, "Status must be 'approved' or 'rejected'");

    // Try MasterDoctorLeave first
    let leave: any = await MasterDoctorLeave.findOne({ _id: leaveId, hospital: hospitalId });

    if (leave) {
      if (leave.status === "rejected") throw new ApiError(400, `Leave is already rejected`);
      if (leave.status === "approved" && status === "approved") throw new ApiError(400, "Leave is already approved");
      
      leave.status = status;
      leave.reviewedBy = reviewerId;
      if (reviewNote) leave.reviewNote = reviewNote;
      await leave.save();
    } else {
      // Fall back to old Leave model
      leave = await (Leave.findOne({ _id: leaveId, hospital: hospitalId }) as any).unscoped();
      if (!leave) throw new ApiError(404, "Leave request not found");
      
      if (leave.status === "rejected") throw new ApiError(400, `Leave is already rejected`);
      if (leave.status === "approved" && status === "approved") throw new ApiError(400, "Leave is already approved");
      
      leave.status = status;
      await leave.save();
    }

    const io = (req as any).io;
    if (io) {
      const doctorId = leave.doctor?.toString() ?? leave.requester?.toString();
      if (doctorId) io.to(`user_${doctorId}`).emit("doctorLeave:status_change", { message: `Leave ${status}`, leave });
    }

    res.json({ message: `Leave ${status} successfully`, leave });
  },
);

// ── Delete pending leave ───────────────────────────────────────────────────────
export const deleteDoctorLeave = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const { leaveId } = req.params;
    const hospitalId = resolveHospital(req);

    let leave: any = await MasterDoctorLeave.findOne({ _id: leaveId, hospital: hospitalId });
    if (leave) {
      if (leave.status !== "pending") throw new ApiError(400, "Only pending leaves can be deleted");
      await MasterDoctorLeave.findByIdAndDelete(leaveId);
    } else {
      leave = await (Leave.findOne({ _id: leaveId, hospital: hospitalId }) as any).unscoped();
      if (!leave) throw new ApiError(404, "Leave not found");
      if (leave.status !== "pending") throw new ApiError(400, "Only pending leaves can be deleted");
      await Leave.findByIdAndDelete(leaveId);
    }

    res.json({ message: "Leave deleted" });
  },
);

// ── Summary stats (both models) ───────────────────────────────────────────────
export const getDoctorLeaveSummary = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const hospitalId = resolveHospital(req);
    const objId = new mongoose.Types.ObjectId(hospitalId);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today); todayEnd.setHours(23, 59, 59, 999);

    const [mPending, mApproved, mRejected, lPending, lApproved, lRejected, mToday, lToday] = await Promise.all([
      MasterDoctorLeave.countDocuments({ hospital: objId, status: "pending" }),
      MasterDoctorLeave.countDocuments({ hospital: objId, status: "approved" }),
      MasterDoctorLeave.countDocuments({ hospital: objId, status: "rejected" }),
      Leave.countDocuments({ hospital: objId, status: "pending" }),
      Leave.countDocuments({ hospital: objId, status: "approved" }),
      Leave.countDocuments({ hospital: objId, status: "rejected" }),
      MasterDoctorLeave.countDocuments({ hospital: objId, status: "approved", startDate: { $lte: todayEnd }, endDate: { $gte: today } }),
      Leave.countDocuments({ hospital: objId, status: "approved", startDate: { $lte: todayEnd }, endDate: { $gte: today } }),
    ]);

    res.json({
      summary: {
        pending: mPending + lPending,
        approved: mApproved + lApproved,
        rejected: mRejected + lRejected,
        total: mPending + mApproved + mRejected + lPending + lApproved + lRejected,
        activeToday: mToday + lToday,
      },
    });
  },
);
