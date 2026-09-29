import { Request, Response } from "express";
// import HelpDesk from "../Models/HelpDesk.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import User from "../../Auth/Models/User.js";
import Patient from "../../Patient/Models/Patient.js";
import bcrypt from "bcrypt";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import mongoose from "mongoose";
import { HelpdeskRequest } from "../types/index.js";
import helpdeskService from "../../services/helpdesk.service.js";
import MobileAppointment from "../../Appointment/Models/MobileAppointment.js";
import Transaction from "../../Admin/Models/Transaction.js";
import StaffProfile from "../../Staff/Models/StaffProfile.js";
import { resolvePatientIdentity } from "../../utils/identityResolver.js";

// Authentication is now handled centrally via Auth/Controllers/authController.ts

export const helpdeskLogin = asyncHandler(
  async (req: Request, res: Response) => {
    const { mobile, password } = req.body;
    if (!mobile || !password)
      throw new ApiError(400, "mobile/loginId and password required");

    // Find helpdesk by mobile or loginId
    const helpdesk: any = await (
      User.findOne({
        role: "helpdesk",
        $or: [{ mobile: mobile }, { loginId: mobile }],
      }) as any
    ).unscoped();

    if (!helpdesk) {
      throw new ApiError(401, "Invalid login credentials");
    }

    const match = await bcrypt.compare(password, helpdesk.password);
    if (!match) {
      throw new ApiError(401, "Password is wrong");
    }

    const { accessToken, csrfToken } =
      await import("../../Auth/Controllers/authController.js").then((m) =>
        m.handleAuthResponse(res, helpdesk, req),
      );

    res.json({
      accessToken,
      csrfToken,
      user: { id: helpdesk._id, name: helpdesk.name, role: "helpdesk" },
    });
  },
);

// Refresh is now handled centrally via Auth/Controllers/authController.ts

export const helpdeskLogout = asyncHandler(
  async (req: Request, res: Response) => {
    const { tokenService } =
      await import("../../Auth/Services/tokenService.js");
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      try {
        const payload = tokenService.verifyRefreshToken(refreshToken);
        const hashedToken = tokenService.hashToken(refreshToken);

        await (
          User.updateOne(
            { _id: payload._id },
            { $pull: { refreshTokens: { tokenHash: hashedToken } } },
          ) as any
        ).unscoped();
      } catch (e) {}
    }

    tokenService.clearCookies(res);
    res.status(204).send();
  },
);

export const helpdeskMe = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    if (!req.user) throw new ApiError(401, "Not authenticated as helpdesk");
    const hd = await (User.findOne({
      _id: (req.user as any)._id,
      role: { $in: ["helpdesk", "masterhelpdesk"] },
    }) as any).unscoped().populate("hospital", "name _id rooms departments opdFollowUpDays ipdFollowUpDays enableFollowUpExpiry");
    if (!hd) throw new ApiError(404, "Profile not found");
    res.json({
      id: hd._id,
      name: hd.name,
      email: hd.email,
      mobile: hd.mobile,
      address: (hd as any).address,
      gender: (hd as any).gender,
      image: (hd as any).image,
      dateOfBirth: (hd as any).dateOfBirth,
      hospital: hd.hospital,
    });
  },
);

export const updateHelpdeskProfile = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    if (!req.user) throw new ApiError(401, "Not authenticated as helpdesk");
    const helpdesk = await (User.findOne({
      _id: (req.user as any)._id,
      role: { $in: ["helpdesk", "masterhelpdesk"] },
    }) as any).unscoped();
    if (!helpdesk) throw new ApiError(404, "HelpDesk not found");

    const { name, email, mobile, address, gender, dateOfBirth, image } =
      req.body;
    if (name) helpdesk.name = name;
    if (email) helpdesk.email = email;
    if (mobile) helpdesk.mobile = mobile;
    if (address !== undefined) (helpdesk as any).address = address;
    if (gender !== undefined) (helpdesk as any).gender = gender;
    if (dateOfBirth) (helpdesk as any).dateOfBirth = dateOfBirth;
    if (image !== undefined) (helpdesk as any).image = image;

    try {
      await helpdesk.save();
      res.json({
        id: helpdesk._id,
        name: helpdesk.name,
        email: helpdesk.email,
        mobile: helpdesk.mobile,
      });
    } catch (err: any) {
      if (err.code === 11000) {
        if (err.keyPattern && err.keyPattern.mobile) {
          throw new ApiError(
            400,
            "This phone number is already registered with another user. Please select another phone number.",
          );
        }
        throw new ApiError(400, "Duplicate field value entered");
      }
      throw err;
    }
  },
);

export const helpDeskDashboard = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const hospitalId = (req as any).hospitalId || (req.user as any).hospital;

    if (!hospitalId) {
      const fallbackHospital = await Hospital.findOne();
      if (!fallbackHospital)
        throw new ApiError(400, "Hospital context required");
      (req.user as any).hospital = fallbackHospital._id;
    }
    const finalHospitalId = (req.user as any).hospital;

    // Date range for today's appointments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Run patient total count and other stats in parallel
    const [
      stats,
      totalPatientsInHospital,
      todayAppointments,
      todayMobileAppointments,
      recentPatientsProfiles,
      revenueAggr,
    ] = await Promise.all([
      helpdeskService.getDashboardStats(finalHospitalId.toString()),
      Patient.countDocuments({ hospitals: finalHospitalId }),
      Appointment.find({
        hospital: finalHospitalId, // ✅ CRITICAL FIX: Explicitly scope to hospital
        $or: [
          { date: { $gte: today, $lt: tomorrow } },
          {
            status: {
              $in: [
                "pending",
                "Pending",
                "confirmed",
                "Confirmed",
                "in-progress",
                "In-Progress",
                "In-progress",
                "Booked",
                "booked",
                "waiting",
                "Waiting",
                "scheduled",
                "Scheduled",
                "Arrived",
                "arrived",
              ],
            },
          },
        ],
        status: { $ne: "cancelled" },
      })
        .populate({
          path: "patient",
          select: "name mobile email",
          model: "Patient",
        })
        .populate({
          path: "doctor",
          populate: { path: "user", select: "name" },
        })
        .sort({ date: 1, createdAt: 1 })
        .limit(100)
        .lean(),
      MobileAppointment.find({
        hospital: finalHospitalId,
        $or: [
          { date: { $gte: today, $lt: tomorrow } },
          { status: { $in: ["Booked", "booked", "Confirmed", "confirmed", "Arrived", "arrived", "In-Progress", "in-progress", "In-progress"] } }
        ]
      })
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "user",
            model: "Patient",
            select: "name mobile email",
          },
        })
        .populate({
          path: "doctor",
          model: "DoctorProfile",
          populate: { path: "user", model: "User", select: "name" },
        })
        .limit(100),
      Patient.find({ hospitals: hospitalId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("name mobile email createdAt")
        .lean(),
      Transaction.aggregate([
        {
          $match: {
            hospital: new mongoose.Types.ObjectId(finalHospitalId),
            date: { $gte: today, $lt: tomorrow },
            status: "completed",
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    // ── Global Patient Name Synchronization ────────────────────────────────
    // Gather all potential user IDs to fetch names globally (bypassing tenant isolation)
    const allUserIds = [
      ...todayAppointments.map((apt: any) => apt.patient?._id || apt.patient),
      ...todayMobileAppointments.map(
        (m: any) => m.patient?.user?._id || m.patient?.user,
      ),
    ].filter((id) => id);

    const globalPatients = await (
      Patient.find({ _id: { $in: allUserIds } }) as any
    ).unscoped();
    const userNameMap = new Map(
      globalPatients.map((p: any) => [p._id.toString(), p.name]),
    );

    // Normalize Mobile Appointments
    const normalizedMobile = todayMobileAppointments.map((m: any) => {
      let userId = m.patient?.user?._id || m.patient?.user;
      let patientName =
        userNameMap.get(userId?.toString()) ||
        m.patient?.user?.name ||
        "Unknown";

      return {
        _id: m._id,
        patient: {
          _id: userId,
          name: patientName,
          mobile: m.patient?.user?.mobile || m.patient?.contactNumber || "N/A",
        },
        doctor: m.doctor,
        status: m.status,
        startTime: m.startTime,
        date: m.date,
        mrn: m.mrn || m.patient?.mrn || "N/A",
        isOnline: true,
      };
    });

    const allAppointments = [...todayAppointments, ...normalizedMobile];

    const patientIds = allAppointments
      .map((apt: any) => apt.patient?._id)
      .filter((id) => id);
    const patientProfiles = await (
      PatientProfile.find({
        user: { $in: patientIds },
      }) as any
    ).unscoped();

    const profileMap = new Map(
      (patientProfiles as any[]).map((p) => [p.user.toString(), p]),
    );

    const appointmentsWithNames = await Promise.all(allAppointments.map(async (apt: any) => {
      const patientUserId =
        apt.patient?._id ||
        (typeof apt.patient === "string" ? apt.patient : null);
      const profile: any = patientUserId
        ? profileMap.get(patientUserId.toString())
        : null;

      let displayType = "OPD";
      if (apt.type === "IPD" || apt.visitType === "IPD" || apt.isIPD)
        displayType = "IPD";
      else if (apt.type === "emergency" || apt.urgency?.includes("Emergency"))
        displayType = "EMERGENCY";

      // ── OPTIMIZATION: Use pre-fetched userNameMap first ──────────────────
      const patientIdStr = patientUserId?.toString();
      const preFetchedName = userNameMap.get(patientIdStr);
      const pName = (preFetchedName && preFetchedName !== "Unknown")
        ? preFetchedName
        : await resolvePatientIdentity(patientUserId, apt);

      return {
        id: apt._id,
        patientId: patientUserId,
        patientName: pName,
        mrn: profile?.mrn || apt.mrn || "N/A",
        doctorId: apt.doctor?._id || (apt.doctor as any)?.user?._id,
        doctorName: apt.doctor?.user?.name || "Unassigned",
        time: apt.appointmentTime || apt.startTime || "N/A",
        status: apt.status,
        type: displayType,
        date: apt.date,
        isOnline: apt.isOnline || false,
      };
    }));

    res.json({
      stats: {
        totalDoctors: stats.totalDoctors,
        totalHelpdesks: stats.totalHelpdesks,
        totalPatients: totalPatientsInHospital,
        todayPatients: stats.totalPatientsRegistered,
        pendingAppointments: stats.activeTransits,
        activeTransits: stats.activeTransits,
        emergencyCases: stats.pendingEmergencyRequests,
        revenueToday: revenueAggr[0]?.total || 0,
      },
      recentPatients: recentPatientsProfiles.map((p: any) => ({
        id: p._id,
        name: p.name,
        contact: p.mobile || p.email,
        registeredAt: p.createdAt,
      })),
      appointments: appointmentsWithNames,
    });
  },
);

/* 
export const helpdeskCreateDoctor = async (req: HelpdeskRequest, res: Response) => {
    // Restricting to hospital-admin and super-admin. Use Admin/Controllers/adminController.ts instead.
    return res.status(403).json({ message: "Helpdesk not authorized to create doctors" });
};
*/

export const getHelpDeskById = asyncHandler(
  async (req: Request, res: Response) => {
    const helpdesk = await User.findOne({
      _id: req.params.id,
      role: "helpdesk",
    })
      .select("-password")
      .populate({
        path: "assignedStaff",
        populate: { path: "user", select: "name email mobile" },
      });
    if (!helpdesk) throw new ApiError(404, "HelpDesk not found");

    let hdObj: any = helpdesk.toObject();

    // Robustness: If assignedStaff is not linked on User doc, search for it by user ID
    if (!hdObj.assignedStaff) {
      const staffProfile = await StaffProfile.findOne({ user: helpdesk._id })
        .populate("user", "name email mobile")
        .lean();
      if (staffProfile) {
        hdObj.assignedStaff = staffProfile;
      }
    }

    console.log("[HELPDESK GET] Returning helpdesk:", {
      id: helpdesk._id,
      name: helpdesk.name,
      loginId: (helpdesk as any).loginId,
      assignedStaff: !!hdObj.assignedStaff,
    });

    res.json(hdObj);
  },
);

export const getHelpDeskDoctors = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const hospitalId = (req as any).hospitalId || req.user?.hospital;
    if (!hospitalId) {
      return res
        .status(400)
        .json({ message: "Hospital not assigned to helpdesk" });
    }

    const doctors = await (DoctorProfile.find({ hospital: hospitalId }) as any)
      .unscoped()
      .populate({
        path: "user",
        select: "name email mobile avatar status",
        options: { unscoped: true }
      })
      .select(
        "specialties qualifications experienceStart experienceYears consultationFee bio availability hospital employeeId isOnline",
      )
      .lean();

    // Only return doctors whose associated user account is active
    const activeDoctors = doctors.filter((doc: any) => doc.user && doc.user.status === "active");

    res.json(activeDoctors);
  },
);

export const getHelpDeskByHospitalId = asyncHandler(
  async (req: Request, res: Response) => {
    const { hospitalId } = req.params;
    const helpdesk = await User.findOne({
      hospital: hospitalId,
      role: "helpdesk",
    }).select("-password");
    if (!helpdesk)
      throw new ApiError(404, "HelpDesk not found for this hospital");
    res.json(helpdesk);
  },
);

// Billing Categories
export const getBillingCategories = asyncHandler(async (req: Request, res: Response) => {
  const hospitalId = (req as any).tenantId || (req as any).user?.hospital;
  if (!hospitalId) throw new ApiError(400, "Hospital ID required");
  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw new ApiError(404, "Hospital not found");
  res.json(hospital.billingCategories || []);
});

export const addBillingCategory = asyncHandler(async (req: Request, res: Response) => {
  const hospitalId = (req as any).tenantId || (req as any).user?.hospital;
  const { category } = req.body;
  if (!hospitalId) throw new ApiError(400, "Hospital ID required");
  if (!category || typeof category !== "string") throw new ApiError(400, "Category name is required");

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw new ApiError(404, "Hospital not found");

  if (!hospital.billingCategories) hospital.billingCategories = [];
  if (hospital.billingCategories.includes(category)) {
    return res.status(400).json({ message: "Category already exists" });
  }

  hospital.billingCategories.push(category);
  await hospital.save();
  res.status(201).json(hospital.billingCategories);
});

export const removeBillingCategory = asyncHandler(async (req: Request, res: Response) => {
  const hospitalId = (req as any).tenantId || (req as any).user?.hospital;
  const { category } = req.params;
  if (!hospitalId) throw new ApiError(400, "Hospital ID required");

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw new ApiError(404, "Hospital not found");

  if (!hospital.billingCategories) hospital.billingCategories = [];
  hospital.billingCategories = hospital.billingCategories.filter(c => c !== category);
  await hospital.save();
  res.json(hospital.billingCategories);
});
