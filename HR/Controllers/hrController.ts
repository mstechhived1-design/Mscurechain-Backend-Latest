import { Request, Response } from "express";
import User from "../../Auth/Models/User.js";
import StaffProfile from "../../Staff/Models/StaffProfile.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import PharmaProfile from "../../Pharmacy/Models/PharmaProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Attendance from "../../Staff/Models/Attendance.js";
import Leave from "../../Leave/Models/Leave.js";
import Payroll from "../../Staff/Models/Payroll.js";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import crypto from "crypto";
import hospitalAdminService from "../../services/hospital-admin.service.js";
import Performance from "../../Performance/Models/Performance.js";
import Recruitment from "../../Recruitment/Models/Recruitment.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";

const STAFF_ROLES = ["doctor", "nurse", "staff", "helpdesk", "hr", "emergency"];

/**
 * HR Dashboard Statistics
 */
export const getHRStats = async (req: Request, res: Response) => {
  try {

    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID not found for HR" });
    }

    const stats = await Promise.all(
      STAFF_ROLES.map(async (role) => {
        const count = await (
          User.countDocuments({ hospital: hospitalId, role }) as any
        ).unscoped();
        return { role, count };
      }),
    );

    const totalStaff = stats.reduce((acc, curr) => acc + curr.count, 0);

    const recentStaff = await (
      User.find({
        hospital: hospitalId,
        role: { $in: STAFF_ROLES },
      }) as any
    )
      .unscoped()
      .sort({ createdAt: -1 })
      .limit(5)
      .select("name role email mobile createdAt status");

    const pendingLeaves = await (
      Leave.countDocuments({
        hospital: hospitalId,
        status: "pending",
      }) as any
    ).unscoped();
    const todayAttendance = await (
      Attendance.countDocuments({
        hospital: hospitalId,
        date: {
          $gte: new Date().setHours(0, 0, 0, 0),
          $lte: new Date().setHours(23, 59, 59, 999),
        },
        status: "present",
      }) as any
    ).unscoped();

    res.json({
      success: true,
      data: {
        totalStaff,
        breakdown: stats,
        recentStaff,
        pendingLeaves,
        todayAttendance,
        hospitalId,
      },
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching HR stats", error: err.message });
  }
};

/**
 * Get All Staff Members
 */
export const getAllStaff = async (req: Request, res: Response) => {
  try {
    const { role, search, page = 1, limit = 10 } = req.query as any;
    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    const query: any = {
      hospital: hospitalId,
      role: { $in: STAFF_ROLES },
    };

    if (role) {
      query.role = role;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [staff, total] = await Promise.all([
      (
        User.find(query)
          .select("-password")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean() as any
      ).unscoped(),
      (User.countDocuments(query) as any).unscoped(),
    ]);

    const enrichedStaff = await Promise.all(
      staff.map(async (member: any) => {
        let profile: any = null;
        if (member.role === "doctor") {
          profile = await DoctorProfile.findOne({ user: member._id }).lean();
        } else if (["staff", "nurse", "emergency"].includes(member.role)) {
          profile = await StaffProfile.findOne({ user: member._id }).lean();
        } else if (member.role === "pharma-owner") {
          profile = await PharmaProfile.findOne({ user: member._id }).lean();
        }
        return { ...member, profile };
      }),
    );

    res.json({
      success: true,
      data: enrichedStaff,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching staff list", error: err.message });
  }
};

/**
 * Create New Staff Member
 */
export const createStaff = async (req: Request, res: Response) => {
  try {
    const { name, email, password, mobile, role, honorific, ...profileData } = req.body;

    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    if (!hospitalId) {
      return res.status(400).json({
        message:
          "Hospital ID is required. If you are a Super Admin, ensure X-Hospital-Id header is set or use the correct portal URL.",
      });
    }

    if (!STAFF_ROLES.includes(role)) {
      return res
        .status(400)
        .json({ message: "Invalid role for HR management" });
    }

    const existing = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existing) {
      return res
        .status(400)
        .json({ message: "User with this email or mobile already exists" });
    }

    const hashedPassword = await bcrypt.hash(password || "Welcome@123", 10);

    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      mobile,
      role,
      hospital: hospitalId,
      gender: profileData.gender,
      dateOfBirth: profileData.dateOfBirth,
      status: "active",
    });

    if (role === "doctor") {
      await DoctorProfile.create({
        ...profileData, // Spread first
        user: newUser._id,
        honorific,
        hospital: hospitalId,
        specialties: profileData.specialties || [],
        qualifications: profileData.qualifications || [],
        experienceStart: profileData.experienceStart || new Date(),
      });
    } else if (["staff", "nurse", "emergency"].includes(role)) {
      const qrSecret = crypto.randomBytes(32).toString("hex");
      await StaffProfile.create({
        ...profileData, // Spread first
        user: newUser._id,
        hospital: hospitalId,
        honorific,
        qrSecret,
      });
    } else if (role === "pharma-owner") {
      await PharmaProfile.create({
        ...profileData, // Spread first
        user: newUser._id,
        hospital: hospitalId,
        businessName: profileData.businessName || `${name}'s Pharmacy`,
      });
    } else if (role === "helpdesk") {
      // Helpdesk specific fields if needed
      await User.findByIdAndUpdate(newUser._id, {
        loginId: profileData.loginId || mobile,
        additionalNotes: profileData.additionalNotes || "",
      });
    }

    await hospitalAdminService.invalidateHospitalCache(hospitalId.toString());

    res.status(201).json({
      success: true,
      message: "Staff member created successfully",
      data: { _id: newUser._id, name: newUser.name, role: newUser.role },
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error creating staff member", error: err.message });
  }
};

/**
 * Staff Leave Management
 */
export const getStaffLeaves = async (req: Request, res: Response) => {
  try {
    const { status, page = 1, limit = 10 } = req.query as any;

    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    const query: any = { hospital: hospitalId };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [leaves, total] = await Promise.all([
      (
        Leave.find(query)
          .populate({
            path: "requester",
            select: "name role email mobile",
            options: { unscoped: true },
          })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean() as any
      ).unscoped(),
      (Leave.countDocuments(query) as any).unscoped(),
    ]);

    res.json({
      success: true,
      data: leaves,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching leaves", error: err.message });
  }
};

export const updateLeaveStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const leave = await Leave.findOneAndUpdate(
      { _id: id, hospital: hospitalId },
      { status },
      { new: true },
    );

    if (!leave)
      return res.status(404).json({ message: "Leave request not found" });

    res.json({
      success: true,
      message: `Leave ${status} successfully`,
      data: leave,
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error updating leave", error: err.message });
  }
};

/**
 * Staff Attendance Management
 * Comprehensive system that shows all active personnel and their status for a specific date
 */
export const getStaffAttendance = async (req: Request, res: Response) => {
  try {
    const {
      date,
      startDate,
      endDate,
      role: filterRole,
      status: filterStatus,
      search,
      page = 1,
      limit = 10,
      showAll = "true",
    } = req.query as any;

    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID not found for HR" });
    }

    // Support both single date and date range
    let targetDate: Date;
    let endOfTargetDate: Date;

    if (startDate && endDate) {
      targetDate = new Date(startDate);
      targetDate.setHours(0, 0, 0, 0);
      endOfTargetDate = new Date(endDate);
      endOfTargetDate.setHours(23, 59, 59, 999);
    } else {
      targetDate = date ? new Date(date) : new Date();
      targetDate.setHours(0, 0, 0, 0);
      endOfTargetDate = new Date(targetDate);
      endOfTargetDate.setHours(23, 59, 59, 999);
    }

    // 1. Get all active personnel — Pharma (pharma-owner) & Lab are excluded via STAFF_ROLES
    const userQuery: any = {
      hospital: hospitalId,
      status: "active",
      role: { $in: STAFF_ROLES },
    };
    if (filterRole && filterRole !== "all") {
      userQuery.role = filterRole;
    }

    const allPersonnel = await (
      User.find(userQuery)
        .select("name role employeeId email mobile")
        .lean() as any
    ).unscoped();

    // 1.5 Fetch StaffProfiles to get employeeId if missing from User
    const staffProfiles = await StaffProfile.find({
      user: { $in: allPersonnel.map((p: any) => p._id) },
    })
      .select("user employeeId")
      .lean();

    const profileEmployeeIdMap = new Map();
    staffProfiles.forEach((p) => {
      profileEmployeeIdMap.set(p.user.toString(), p.employeeId);
    });

    // 2. Get attendance records for the date range
    const attendanceRecords = await (
      Attendance.find({
        hospital: hospitalId,
        date: { $gte: targetDate, $lte: endOfTargetDate },
      }).lean() as any
    ).unscoped();

    const attendanceMap = new Map();
    attendanceRecords.forEach((rec) => {
      attendanceMap.set(rec.user.toString(), rec);
    });

    // 3. Get approved leaves for this date
    const approvedLeaves = await (
      Leave.find({
        hospital: hospitalId,
        status: "approved",
        startDate: { $lte: endOfTargetDate },
        endDate: { $gte: targetDate },
      }).lean() as any
    ).unscoped();

    const leaveUserIds = new Set(
      approvedLeaves.map((l) => l.requester.toString()),
    );

    // 4. Merge data
    let finalResult = allPersonnel.map((person) => {
      const userIdStr = person._id.toString();
      const attendance = attendanceMap.get(userIdStr);
      const isOnLeave = leaveUserIds.has(userIdStr);

      let status = "absent";
      if (attendance) {
        status = attendance.status || "present";
      } else if (isOnLeave) {
        status = "on-leave";
      }

      return {
        _id: attendance?._id || `v-${userIdStr}`,
        user: {
          ...person,
          employeeId:
            person.employeeId || profileEmployeeIdMap.get(userIdStr) || "N/A",
        },
        date: targetDate,
        checkIn: attendance?.checkIn,
        checkOut: attendance?.checkOut,
        status,
        isVirtual: !attendance,
        notes: attendance?.notes,
      };
    });

    // 5. Apply Status Filter
    if (filterStatus && filterStatus !== "all") {
      finalResult = finalResult.filter((r) => r.status === filterStatus);
    }

    // 5.5 Apply Search Filter
    if (search) {
      const searchLower = search.toLowerCase();
      finalResult = finalResult.filter(
        (r) =>
          r.user.name?.toLowerCase().includes(searchLower) ||
          r.user.employeeId?.toLowerCase().includes(searchLower) ||
          r.user.email?.toLowerCase().includes(searchLower) ||
          r.user.mobile?.toLowerCase().includes(searchLower),
      );
    }

    // 6. Calculate Stats for the dashboard
    const stats = {
      total: allPersonnel.length,
      present: finalResult.filter((r) => r.status === "present").length,
      late: finalResult.filter((r) => r.status === "late").length,
      absent: finalResult.filter((r) => r.status === "absent").length,
      onLeave: finalResult.filter((r) => r.status === "on-leave").length,
    };

    // 7. Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const total = finalResult.length;
    const paginatedResult = finalResult.slice(
      (pageNum - 1) * limitNum,
      pageNum * limitNum,
    );

    res.json({
      success: true,
      data: paginatedResult,
      stats,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching attendance", error: err.message });
  }
};

/**
 * Payroll Management
 */
export const getStaffPayroll = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, page = 1, limit = 10 } = req.query as any;

    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    const query: any = { hospital: hospitalId };
    if (startDate && endDate) {
      const s = new Date(startDate);
      s.setHours(0, 0, 0, 0);
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);

      query.$or = [
        { startDate: { $gte: s, $lte: e } },
        { endDate: { $gte: s, $lte: e } },
        { startDate: { $lte: s }, endDate: { $gte: e } },
      ];
    } else if (req.query.month && req.query.year) {
      query.month = parseInt(req.query.month as string);
      query.year = parseInt(req.query.year as string);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [payrolls, total, hospital] = await Promise.all([
      (
        Payroll.find(query)
          .populate({
            path: "user",
            select: "name role employeeId",
            options: { unscoped: true },
          })
          .sort({ year: -1, month: -1, startDate: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean() as any
      ).unscoped(),
      (Payroll.countDocuments(query) as any).unscoped(),
      Hospital.findById(hospitalId).select("name email phone address").lean(),
    ]);

    res.json({
      success: true,
      payrolls,
      hospital,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching payroll", error: err.message });
  }
};

export const getStaffDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    const user = await (
      User.findOne({ _id: id, hospital: hospitalId }).select(
        "-password",
      ) as any
    ).unscoped();
    if (!user)
      return res.status(404).json({ message: "Staff member not found" });

    let profile: any = null;
    if (user.role === "doctor")
      profile = await (
        DoctorProfile.findOne({ user: user._id }) as any
      ).unscoped();
    else if (["staff", "nurse", "emergency"].includes(user.role))
      profile = await (
        StaffProfile.findOne({ user: user._id }) as any
      ).unscoped();

    res.json({ success: true, data: { ...user.toObject(), profile } });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching details", error: err.message });
  }
};

/**
 * Recruitment Management
 */
export const getHRRecruitment = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user.hospital;
    const recruitments = await (
      Recruitment.find({ hospital: hospitalId })
        .populate({
          path: "createdBy",
          select: "name color",
          options: { unscoped: true },
        })
        .populate({
          path: "approvedBy",
          select: "name",
          options: { unscoped: true },
        })
        .sort({ createdAt: -1 }) as any
    ).unscoped();

    res.json({
      success: true,
      data: recruitments,
      hospitalId,
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching recruitment data", error: err.message });
  }
};

/**
 * Performance & Appraisals
 */
export const getHRPerformance = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user.hospital;
    const { month, year } = req.query as any;

    // Compute date range for the target month
    const targetMonth = month ? parseInt(month) : new Date().getMonth();
    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);

    const allPersonnel = await (
      User.find({
        hospital: hospitalId,
        status: "active",
        role: {
          $in: [
            "doctor",
            "nurse",
            "staff",
            "emergency",
            "helpdesk",
            "hr",
            "hospital-admin",
          ],
        },
      })
        .select("name role employeeId image email mobile createdAt")
        .lean() as any
    ).unscoped();

    // 2. Calculate metrics for each personnel
    const enrichedStaff = await Promise.all(
      allPersonnel.map(async (person) => {
        // Attendance
        const monthlyAttendance = await Attendance.aggregate([
          {
            $match: {
              user: person._id,
              hospital: new mongoose.Types.ObjectId(hospitalId),
              date: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: "$user",
              totalDays: { $sum: 1 },
              presentDays: {
                $sum: {
                  $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0],
                },
              },
            },
          },
        ]);

        let attendanceRate = 0;
        if (monthlyAttendance.length > 0) {
          const summary = monthlyAttendance[0];
          attendanceRate =
            summary.totalDays > 0
              ? Math.round((summary.presentDays / summary.totalDays) * 100)
              : 0;
        }

        // Role-specific metrics
        let additionalMetrics: any = { taskCompletionRate: 0 };
        let baseScore = attendanceRate / 20; // 0-5 scale
        let compositeScore = baseScore;

        if (person.role === "doctor") {
          const doctorProfile = await (
            DoctorProfile.findOne({
              user: person._id,
            }) as any
          ).unscoped();
          const appCount = await Appointment.countDocuments({
            doctor: doctorProfile?._id,
            createdAt: { $gte: startDate, $lte: endDate },
          });
          const prescCount = await Prescription.countDocuments({
            doctor: doctorProfile?._id,
            createdAt: { $gte: startDate, $lte: endDate },
          });

          additionalMetrics = {
            appointmentCount: appCount,
            prescriptionCount: prescCount,
          };
          const activityScore =
            (Math.min(5, appCount / 20) + Math.min(5, prescCount / 10)) / 2;
          compositeScore = baseScore * 0.4 + activityScore * 0.6; // Higher weight for patient care
        } else if (person.role === "nurse") {
          const taskCount = await mongoose.connections[0]
            .collection("nursingtasks")
            .countDocuments({
              assignedTo: person._id,
              completed: true,
              createdAt: { $gte: startDate, $lte: endDate },
            });
          additionalMetrics = { taskCompletionRate: taskCount };
          const taskScore = Math.min(5, taskCount / 10);
          compositeScore = baseScore * 0.6 + taskScore * 0.4;
        } else if (person.role === "staff") {
          const taskCount = await mongoose.connections[0]
            .collection("generalstafftasks")
            .countDocuments({
              assignedTo: person._id,
              completed: true,
              createdAt: { $gte: startDate, $lte: endDate },
            });
          additionalMetrics = { taskCompletionRate: taskCount };
          const taskScore = Math.min(5, taskCount / 5);
          compositeScore = baseScore * 0.6 + taskScore * 0.4;
        }

        return {
          _id: `auto-${person._id}`,
          user: person,
          period: `${targetMonth + 1}/${targetYear}`,
          score: parseFloat(compositeScore.toFixed(1)),
          status: "completed",
          metrics: {
            attendanceRate,
            technicalSkills: compositeScore, // Mapping for frontend progress bars
            ...additionalMetrics,
          },
          reviewDate: new Date(),
        };
      }),
    );

    // 3. Categorize
    const doctors = enrichedStaff.filter((s) => s.user.role === "doctor");
    const otherStaff = enrichedStaff.filter((s) => s.user.role !== "doctor");

    // 4. Stats
    const stats = {
      avgScore:
        enrichedStaff.length > 0
          ? (
            enrichedStaff.reduce((acc, curr) => acc + curr.score, 0) /
            enrichedStaff.length
          ).toFixed(1)
          : "0.0",
      completedRate: 100, // Fully automated
      highPerformers: enrichedStaff.filter((s) => s.score >= 4.5).length,
      needsImprovement: enrichedStaff.filter((s) => s.score <= 3.0).length,
      topDoctor: doctors.sort((a, b) => b.score - a.score)[0],
      topStaff: otherStaff.sort((a, b) => b.score - a.score)[0],
    };

    res.json({
      success: true,
      data: {
        doctors,
        otherStaff,
        all: enrichedStaff,
      },
      stats,
      hospitalId,
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching performance data", error: err.message });
  }
};

/**
 * Submit Performance Review
 */
export const submitHRPerformance = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user.hospital;
    const reviewerId = (req as any).user.id;
    const { user, period, score, notes, metrics, status } = req.body;

    const performance = await Performance.findOneAndUpdate(
      { hospital: hospitalId, user, period },
      {
        hospital: hospitalId,
        user,
        period,
        score,
        notes,
        metrics,
        status: status || "completed",
        reviewer: reviewerId,
        reviewDate: new Date(),
      },
      { upsert: true, new: true },
    );

    res.status(201).json({
      success: true,
      data: performance,
      message: "Performance review submitted successfully",
    });
  } catch (err: any) {
    res.status(500).json({
      message: "Error submitting performance review",
      error: err.message,
    });
  }
};

/**
 * Document Vault - Fetches all documents uploaded by staff and doctors
 */
export const getHRDocuments = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user.hospital;
    const { category, search } = req.query as any;
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "10", 10);

    // 1. Get all staff members (including doctors)
    const allStaff = await User.find({
      hospital: hospitalId,
      status: "active",
      role: { $in: STAFF_ROLES },
    }).select("_id name role employeeId image email mobile createdAt");

    // 2. Fetch profiles to get document URLs
    const documentVault: any[] = [];

    await Promise.all(
      allStaff.map(async (staff) => {
        let profile: any = null;
        if (staff.role === "doctor") {
          profile = await (
            DoctorProfile.findOne({ user: staff._id }) as any
          ).unscoped();
        } else if (
          ["staff", "nurse", "emergency", "helpdesk", "hr"].includes(staff.role)
        ) {
          profile = await (
            StaffProfile.findOne({ user: staff._id }) as any
          ).unscoped();
        }

        if (profile) {
          // 2a. Extract from Unified documents Object (Now supported by both roles)
          if (profile.documents) {
            Object.entries(profile.documents).forEach(
              ([key, doc]: [string, any]) => {
                if (doc && doc.url) {
                  // Determine expiry based on profile type
                  let expiryDate = null;
                  if (staff.role === "doctor") {
                    expiryDate = (profile as any).registrationExpiryDate;
                  } else {
                    expiryDate =
                      profile.qualificationDetails?.licenseValidityDate;
                  }

                  let status = "verified";
                  if (expiryDate) {
                    const now = new Date();
                    const expiry = new Date(expiryDate);
                    const diffDays = Math.ceil(
                      (expiry.getTime() - now.getTime()) / (1000 * 3600 * 24),
                    );
                    if (diffDays < 0) status = "expired";
                    else if (diffDays < 30) status = "expiring";
                  }

                  documentVault.push({
                    id: `${profile._id}-${key}`,
                    title: `${key.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase())} - ${staff.name}`,
                    type: key
                      .replace(/([A-Z])/g, " $1")
                      .replace(/^./, (str) => str.toUpperCase()),
                    staff: staff.name,
                    category: getCategoryFromDocType(key),
                    size: `${(Math.random() * 2 + 0.5).toFixed(1)} MB`,
                    date: profile.updatedAt
                      ? new Date(profile.updatedAt).toLocaleDateString()
                      : "N/A",
                    status,
                    url: doc.url,
                    publicId: doc.publicId,
                    expiryDate: expiryDate || null,
                    // Deletion metadata
                    profileId: profile._id,
                    documentKey: key,
                    role: staff.role,
                  });
                }
              },
            );
          }

          // 2b. Extract from DoctorProfile Legacy Fields (ONLY if not already in unified store to avoid duplicates)
          if (staff.role === "doctor") {
            const doctorDocs = [
              {
                key: "degreeCertificate",
                title: "Degree Certificate",
                url: (profile as any).degreeCertificate,
              },
              {
                key: "registrationCertificate",
                title: "Registration Certificate",
                url: (profile as any).registrationCertificate,
              },
              {
                key: "doctorateCertificate",
                title: "Doctorate Certificate",
                url: (profile as any).doctorateCertificate,
              },
              {
                key: "internshipCertificate",
                title: "Internship Certificate",
                url: (profile as any).internshipCertificate,
              },
            ];

            const doctorExpiry = (profile as any).registrationExpiryDate;
            let docStatus = "verified";
            if (doctorExpiry) {
              const now = new Date();
              const expiry = new Date(doctorExpiry);
              const diffDays = Math.ceil(
                (expiry.getTime() - now.getTime()) / (1000 * 3600 * 24),
              );
              if (diffDays < 0) docStatus = "expired";
              else if (diffDays < 30) docStatus = "expiring";
            }

            doctorDocs.forEach((doc) => {
              if (doc.url && typeof doc.url === "string") {
                // Skip if this key is already in the unified documents object
                if (profile.documents && profile.documents[doc.key]) return;

                documentVault.push({
                  id: `${profile._id}-${doc.key}`,
                  title: `${doc.title} - ${staff.name}`,
                  type: doc.title,
                  staff: staff.name,
                  category: getCategoryFromDocType(doc.key),
                  size: `${(Math.random() * 2 + 1).toFixed(1)} MB`,
                  date: profile.updatedAt
                    ? new Date(profile.updatedAt).toLocaleDateString()
                    : "N/A",
                  status: docStatus,
                  url: doc.url,
                  expiryDate: doctorExpiry || null,
                  // Deletion metadata
                  profileId: profile._id,
                  documentKey: doc.key,
                  role: staff.role,
                });
              }
            });
          }
        }
      }),
    );

    // 3. Apply Filters
    let filteredVault = documentVault;
    if (category && category !== "all") {
      filteredVault = filteredVault.filter((doc) => doc.category === category);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      filteredVault = filteredVault.filter(
        (doc) =>
          doc.title.toLowerCase().includes(searchLower) ||
          doc.staff.toLowerCase().includes(searchLower),
      );
    }

    // 4. Calculate Stats
    const stats = {
      totalDocuments: documentVault.length,
      complianceStatus: "98%",
      expiringSoon: documentVault.filter((d) => d.status === "expiring").length,
      pendingReview: documentVault.filter((d) => d.status === "expired").length,
    };

    const categories = [
      { name: "All Documents", value: "all", count: documentVault.length },
      {
        name: "Contracts",
        value: "contracts",
        count: documentVault.filter((d) => d.category === "contracts").length,
      },
      {
        name: "ID Proofs",
        value: "ids",
        count: documentVault.filter((d) => d.category === "ids").length,
      },
      {
        name: "Medical Licenses",
        value: "licenses",
        count: documentVault.filter((d) => d.category === "licenses").length,
      },
      {
        name: "Certificates",
        value: "certificates",
        count: documentVault.filter((d) => d.category === "certificates")
          .length,
      },
    ];

    // 5. Apply Pagination
    const skip = (page - 1) * limit;
    const paginatedVault = filteredVault.slice(skip, skip + limit);
    const totalPages = Math.ceil(filteredVault.length / limit);

    res.json({
      success: true,
      data: paginatedVault,
      stats,
      categories,
      hospitalId,
      pagination: {
        total: filteredVault.length,
        page,
        limit,
        totalPages,
      },
      message: "Document Vault data fetched successfully",
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching document data", error: err.message });
  }
};

const getCategoryFromDocType = (type: string): string => {
  const t = type.toLowerCase();
  if (t.includes("contract")) return "contracts";
  if (t.includes("id") || t.includes("aadhar") || t.includes("pan"))
    return "ids";
  if (t.includes("license") || t.includes("registration")) return "licenses";
  if (t.includes("certificate") || t.includes("degree")) return "certificates";
  return "certificates";
};

/**
 * Training & Development
 */
export const getHRTraining = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user.hospital;
    res.json({
      success: true,
      data: [],
      hospitalId,
      message: "Training module initialized",
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching training data", error: err.message });
  }
};

/**
 * Performance Dashboard - Top Performers by Attendance and Overall Metrics
 */
export const getPerformanceDashboard = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user.hospital;

    // Get all active staff members
    const allStaff = await User.find({
      hospital: hospitalId,
      status: "active",
      role: { $in: STAFF_ROLES },
    }).select("_id name role employeeId image email mobile createdAt");

    // Calculate attendance rates for each staff member over the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { month, year } = req.query; // Get month and year from query params

    // Set default to current month/year if not provided
    const targetMonth = month
      ? parseInt(month as string)
      : new Date().getMonth();
    const targetYear = year
      ? parseInt(year as string)
      : new Date().getFullYear();

    // Calculate start and end dates for the specified month
    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0); // Last day of the month
    endDate.setHours(23, 59, 59, 999);

    const performanceData = await Promise.all(
      allStaff.map(async (staff) => {
        // Calculate attendance rate for the specific month
        const monthlyAttendance = await Attendance.aggregate([
          {
            $match: {
              user: staff._id,
              hospital: new mongoose.Types.ObjectId(hospitalId),
              date: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: "$user",
              totalDays: { $sum: 1 },
              presentDays: {
                $sum: {
                  $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0],
                },
              },
              lateDays: {
                $sum: {
                  $cond: [{ $eq: ["$status", "late"] }, 1, 0],
                },
              },
              absentDays: {
                $sum: {
                  $cond: [{ $eq: ["$status", "absent"] }, 1, 0],
                },
              },
              onLeaveDays: {
                $sum: {
                  $cond: [{ $eq: ["$status", "on-leave"] }, 1, 0],
                },
              },
            },
          },
        ]);

        let attendanceRate = 0;
        let totalDays = 0;
        let presentDays = 0;
        let lateDays = 0;
        let absentDays = 0;
        let onLeaveDays = 0;

        if (monthlyAttendance.length > 0) {
          const attendanceSummary = monthlyAttendance[0];
          totalDays = attendanceSummary.totalDays || 0;
          presentDays = attendanceSummary.presentDays || 0;
          lateDays = attendanceSummary.lateDays || 0;
          absentDays = attendanceSummary.absentDays || 0;
          onLeaveDays = attendanceSummary.onLeaveDays || 0;

          attendanceRate =
            totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
        }

        // 1. Get additional metrics based on role FIRST
        let additionalMetrics: any = { taskCompletionRate: 0 };
        if (staff.role === "nurse") {
          const taskCompletionCount = await (mongoose.connections[0]
            .collection("nursingtasks")
            .countDocuments({
              assignedTo: staff._id,
              completed: true,
              createdAt: { $gte: startDate, $lte: endDate },
            }) as any);

          additionalMetrics = {
            taskCompletionRate: taskCompletionCount,
            patientInteractionScore: 8,
          };
        } else if (staff.role === "staff") {
          const taskCompletionCount = await (mongoose.connections[0]
            .collection("generalstafftasks")
            .countDocuments({
              assignedTo: staff._id,
              completed: true,
              createdAt: { $gte: startDate, $lte: endDate },
            }) as any);

          additionalMetrics = {
            taskCompletionRate: taskCompletionCount,
            efficiencyRating: 7,
          };
        }

        // 2. Calculate composite score based on attendance and other metrics
        // Fully automated - no manual performance reviews
        let attendanceScore = attendanceRate / 20; // Scale attendance to contribute up to 5 points
        let compositeScore = attendanceScore;

        // Adjust score based on attendance days rather than star ratings
        // Calculate based on actual present days vs total days
        if (staff.role === "nurse") {
          // For nurses, emphasize attendance consistency
          if (totalDays > 0) {
            // Calculate score based on attendance rate: 0-5 scale
            compositeScore = (presentDays / totalDays) * 5;
            // Add small boost for task completion
            if (additionalMetrics.taskCompletionRate > 0) {
              const taskBoost = Math.min(
                0.5,
                additionalMetrics.taskCompletionRate / 20,
              );
              compositeScore = Math.min(5, compositeScore + taskBoost);
            }
          }
        } else if (staff.role === "staff") {
          // For staff, emphasize attendance consistency
          if (totalDays > 0) {
            // Calculate score based on attendance rate: 0-5 scale
            compositeScore = (presentDays / totalDays) * 5;
            // Add small boost for task completion
            if (additionalMetrics.taskCompletionRate > 0) {
              const taskBoost = Math.min(
                0.5,
                additionalMetrics.taskCompletionRate / 15,
              );
              compositeScore = Math.min(5, compositeScore + taskBoost);
            }
          }
        }

        return {
          _id: staff._id,
          name: staff.name,
          role: staff.role,
          employeeId: staff.employeeId,
          image: staff.image,
          attendance: {
            totalDays,
            presentDays,
            lateDays,
            absentDays,
            onLeaveDays,
            rate: attendanceRate,
          },
          compositeScore: parseFloat(compositeScore.toFixed(2)),
          additionalMetrics,
          joinDate: staff.createdAt,
          period: `${targetMonth + 1}/${targetYear}`,
        };
      }),
    );

    // Separate staff by roles (excluding pharma and lab)
    const doctors = performanceData.filter((staff) => staff.role === "doctor");
    const nurses = performanceData.filter((staff) => staff.role === "nurse");
    const otherStaff = performanceData.filter((staff) =>
      ["staff"].includes(staff.role),
    );

    // Sort by composite score to get top performers
    const sortedDoctors = [...doctors].sort(
      (a, b) => b.compositeScore - a.compositeScore,
    );
    const sortedNurses = [...nurses].sort(
      (a, b) => b.compositeScore - a.compositeScore,
    );
    const sortedStaff = [...otherStaff].sort(
      (a, b) => b.compositeScore - a.compositeScore,
    );

    // Get top 5 performers in each category
    const topPerformers = {
      doctors: sortedDoctors.slice(0, 5),
      nurses: sortedNurses.slice(0, 5),
      staff: sortedStaff.slice(0, 5),
      overall: [...performanceData]
        .sort((a, b) => b.compositeScore - a.compositeScore)
        .slice(0, 10),
    };

    // Calculate aggregate statistics
    const stats = {
      totalStaff: allStaff.length,
      avgAttendanceRate:
        Math.round(
          performanceData.reduce(
            (sum, staff) => sum + staff.attendance.rate,
            0,
          ) / performanceData.length,
        ) || 0,
      avgCompositeScore: parseFloat(
        (
          performanceData.reduce(
            (sum, staff) => sum + staff.compositeScore,
            0,
          ) / performanceData.length || 0
        ).toFixed(2),
      ),
      highPerformers: performanceData.filter(
        (staff) => staff.compositeScore >= 4.0,
      ).length,
      attendanceBelow70: performanceData.filter(
        (staff) => staff.attendance.rate < 70,
      ).length,
      newJoiners: allStaff.filter((staff) => {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        return staff.createdAt > ninetyDaysAgo;
      }).length,
      period: `${targetMonth + 1}/${targetYear}`,
    };

    res.json({
      success: true,
      data: {
        topPerformers,
        stats,
        hospitalId,
      },
      message: `Performance dashboard data for ${targetMonth + 1}/${targetYear} fetched successfully`,
    });
  } catch (err: any) {
    console.error("Error in getPerformanceDashboard:", err);
    res.status(500).json({
      message: "Error fetching performance dashboard",
      error: err.message,
    });
  }
};
/**
 * Doctor Performance Dashboard - Top Performing Doctors
 */
export const getDoctorPerformanceDashboard = async (
  req: Request,
  res: Response,
) => {
  try {
    const hospitalId = (req as any).user.hospital;

    // Get all active doctors
    const allDoctors = await (
      User.find({
        hospital: hospitalId,
        status: "active",
        role: "doctor",
      }).select("_id name role employeeId image email mobile createdAt") as any
    ).unscoped();

    // Calculate doctor-specific metrics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { month, year } = req.query; // Get month and year from query params

    // Set default to current month/year if not provided
    const targetMonth = month
      ? parseInt(month as string)
      : new Date().getMonth();
    const targetYear = year
      ? parseInt(year as string)
      : new Date().getFullYear();

    // Calculate start and end dates for the specified month
    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0); // Last day of the month
    endDate.setHours(23, 59, 59, 999);

    const performanceData = await Promise.all(
      allDoctors.map(async (doctor) => {
        // Get doctor profile
        const doctorProfile = await (
          DoctorProfile.findOne({ user: doctor._id }) as any
        ).unscoped();

        // Calculate appointment metrics for the specific month
        const appointmentCount = await Appointment.countDocuments({
          doctor: doctorProfile?._id,
          createdAt: { $gte: startDate, $lte: endDate },
        });

        // Calculate prescription metrics for the specific month
        const prescriptionCount = await Prescription.countDocuments({
          doctor: doctorProfile?._id,
          createdAt: { $gte: startDate, $lte: endDate },
        });

        // Calculate attendance rate for the specific month
        const monthlyAttendance = await Attendance.aggregate([
          {
            $match: {
              user: doctor._id,
              hospital: new mongoose.Types.ObjectId(hospitalId),
              date: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: "$user",
              totalDays: { $sum: 1 },
              presentDays: {
                $sum: {
                  $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0],
                },
              },
              lateDays: {
                $sum: {
                  $cond: [{ $eq: ["$status", "late"] }, 1, 0],
                },
              },
              absentDays: {
                $sum: {
                  $cond: [{ $eq: ["$status", "absent"] }, 1, 0],
                },
              },
              onLeaveDays: {
                $sum: {
                  $cond: [{ $eq: ["$status", "on-leave"] }, 1, 0],
                },
              },
            },
          },
        ]);

        let attendanceRate = 0;
        let totalDays = 0;
        let presentDays = 0;
        let lateDays = 0;
        let absentDays = 0;
        let onLeaveDays = 0;

        if (monthlyAttendance.length > 0) {
          const attendanceSummary = monthlyAttendance[0];
          totalDays = attendanceSummary.totalDays || 0;
          presentDays = attendanceSummary.presentDays || 0;
          lateDays = attendanceSummary.lateDays || 0;
          absentDays = attendanceSummary.absentDays || 0;
          onLeaveDays = attendanceSummary.onLeaveDays || 0;

          attendanceRate =
            totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
        }

        // Calculate composite score based on multiple factors
        // Fully automated - no manual performance reviews
        // Calculate based on actual present days vs total days for attendance

        // Base composite score on appointments, prescriptions, and attendance
        // Emphasize attendance as primary factor
        let compositeScore = 0;

        if (totalDays > 0) {
          // Base score on attendance: 60% weight
          const attendanceComponent = (presentDays / totalDays) * 5 * 0.6;

          // Add appointment component: 25% weight
          const appointmentComponent =
            Math.min(5, appointmentCount / 25) * 0.25;

          // Add prescription component: 15% weight
          const prescriptionComponent =
            Math.min(5, prescriptionCount / 30) * 0.15;

          compositeScore =
            attendanceComponent + appointmentComponent + prescriptionComponent;
        } else {
          // Fallback if no attendance data
          const appointmentComponent = Math.min(5, appointmentCount / 25) * 0.5;
          const prescriptionComponent =
            Math.min(5, prescriptionCount / 30) * 0.5;
          compositeScore = appointmentComponent + prescriptionComponent;
        }

        return {
          _id: doctor._id,
          name: doctor.name,
          role: doctor.role,
          employeeId: doctor.employeeId,
          image: doctor.image,
          appointmentCount,
          prescriptionCount,
          attendance: {
            totalDays,
            presentDays,
            lateDays,
            absentDays,
            onLeaveDays,
            rate: attendanceRate,
          },
          compositeScore: parseFloat(compositeScore.toFixed(2)),
          specialization: doctorProfile?.specialties?.join(", ") || "General",
          joinDate: doctor.createdAt,
          period: `${targetMonth + 1}/${targetYear}`,
        };
      }),
    );

    // Sort by composite score to get top performing doctors
    const sortedDoctors = [...performanceData].sort(
      (a, b) => b.compositeScore - a.compositeScore,
    );

    // Get top 10 performing doctors
    const topPerformingDoctors = sortedDoctors.slice(0, 10);

    // Calculate aggregate statistics
    const stats = {
      totalDoctors: allDoctors.length,
      avgAppointmentCount:
        Math.round(
          performanceData.reduce((sum, doc) => sum + doc.appointmentCount, 0) /
          performanceData.length,
        ) || 0,
      avgPrescriptionCount:
        Math.round(
          performanceData.reduce((sum, doc) => sum + doc.prescriptionCount, 0) /
          performanceData.length,
        ) || 0,
      avgAttendanceRate:
        Math.round(
          performanceData.reduce((sum, doc) => sum + doc.attendance.rate, 0) /
          performanceData.length,
        ) || 0,
      avgCompositeScore: parseFloat(
        (
          performanceData.reduce((sum, doc) => sum + doc.compositeScore, 0) /
          performanceData.length || 0
        ).toFixed(2),
      ),
      highPerformers: performanceData.filter((doc) => doc.compositeScore >= 4.0)
        .length,
      period: `${targetMonth + 1}/${targetYear}`,
    };

    res.json({
      success: true,
      data: {
        topPerformingDoctors,
        stats,
        hospitalId,
      },
      message: `Doctor performance dashboard data for ${targetMonth + 1}/${targetYear} fetched successfully`,
    });
  } catch (err: any) {
    console.error("Error in getDoctorPerformanceDashboard:", err);
    res.status(500).json({
      message: "Error fetching doctor performance dashboard",
      error: err.message,
    });
  }
};

/**
 * Upload Document by HR - For any staff member
 */
export const uploadHRDocument = async (req: Request, res: Response) => {
  try {
    const { staffId, documentType } = req.body;
    const hospitalId = (req as any).user.hospital;

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // 1. Validate Staff Exists and belongs to this hospital
    const staff = await (
      User.findOne({ _id: staffId, hospital: hospitalId }) as any
    ).unscoped();
    if (!staff) {
      return res.status(404).json({ message: "Staff member not found" });
    }

    const isPdf = req.file.mimetype === "application/pdf";
    const resourceType = isPdf ? "raw" : "image";
    const publicId = `hr_docs/${hospitalId}/${staffId}_${documentType}_${Date.now()}`;

    // 2. Upload to Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, {
      public_id: publicId,
      resource_type: resourceType,
      access_mode: "public",
    });

    // 3. Update Profile - Unified Documents Store
    let profileUpdateSuccess = false;
    const docData = { url: result.secure_url, publicId: result.public_id };

    let profile: any;
    if (staff.role === "doctor") {
      profile = await (
        DoctorProfile.findOne({ user: staffId }) as any
      ).unscoped();
    } else {
      profile = await (
        StaffProfile.findOne({ user: staffId }) as any
      ).unscoped();
    }

    if (profile) {
      if (!profile.documents) {
        (profile as any).documents = {};
      }

      // Update the unified store
      (profile as any).documents[documentType] = docData;

      // Legacy compatibility for Doctor Profile main fields if applicable
      if (staff.role === "doctor") {
        const fieldMap: any = {
          degreeCertificate: "degreeCertificate",
          registrationCertificate: "registrationCertificate",
          doctorateCertificate: "doctorateCertificate",
          internshipCertificate: "internshipCertificate",
        };
        const legacyField = fieldMap[documentType];
        if (legacyField) {
          (profile as any)[legacyField] = result.secure_url;
        }
      }

      profile.markModified("documents");
      await profile.save();
      profileUpdateSuccess = true;
    }

    if (!profileUpdateSuccess) {
      return res
        .status(400)
        .json({ message: "Could not update staff profile with document" });
    }

    res.status(201).json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        staff: staff.name,
        documentType,
        resource_type: resourceType,
        format: result.format || (isPdf ? "pdf" : req.file.mimetype.split("/")[1]),
      },
      message:
        "Document uploaded and associated with staff profile successfully",
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error uploading document", error: err.message });
  }
};

/**
 * Delete Document from Vault
 */
export const deleteHRDocument = async (req: Request, res: Response) => {
  try {
    const { profileId, documentKey, role } = req.body;
    const hospitalId = (req as any).user.hospital;

    const profileModel = role === "doctor" ? DoctorProfile : StaffProfile;
    const profile = await (profileModel as any).findOne({
      _id: profileId,
      hospital: hospitalId,
    });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // 1. Delete from Unified Store
    if (profile.documents && (profile.documents as any)[documentKey]) {
      delete (profile.documents as any)[documentKey];
      profile.markModified("documents");
    }

    // 2. Clear Legacy Fields for Doctors if applicable
    if (role === "doctor") {
      const fieldMap: any = {
        degreeCertificate: "degreeCertificate",
        registrationCertificate: "registrationCertificate",
        doctorateCertificate: "doctorateCertificate",
        internshipCertificate: "internshipCertificate",
      };
      const legacyField = fieldMap[documentKey];
      if (legacyField && (profile as any)[legacyField]) {
        (profile as any)[legacyField] = undefined;
      }
    }

    await profile.save();
    res.json({ success: true, message: "Document deleted successfully" });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error deleting document", error: err.message });
  }
};
