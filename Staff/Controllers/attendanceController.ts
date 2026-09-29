import { Request, Response } from "express";
import Attendance from "../Models/Attendance.js";
import StaffProfile from "../Models/StaffProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Leave from "../../Leave/Models/Leave.js";
import Shift from "../Models/Shift.js";
import User from "../../Auth/Models/User.js";
import mongoose from "mongoose";
import crypto from "crypto";
import staffService from "../../services/staff.service.js";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";
import Payroll from "../Models/Payroll.js";
import { processSingleProfileExpiry } from "../../services/reminderService.js";
import { decryptObject } from "../../utils/crypto.js";

// Helper: Get current time components in IST (Asia/Kolkata)
const getHospitalContext = () => {
  const now = new Date();
  const istStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istNow = new Date(istStr);
  
  // Storage-safe "today" at UTC midnight relative to IST day
  const istDate = new Date(Date.UTC(
    istNow.getFullYear(),
    istNow.getMonth(),
    istNow.getDate()
  ));

  return { 
    realNow: now,      // Use for DB storage (check-in/out timestamps)
    logicalNow: istNow, // Use for business logic (if/else shifts)
    today: istDate     // Use for indexing (date field)
  };
};

// Helper: Calculate distance between two coordinates in meters
const getDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) => {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
    Math.cos(phi2) *
    Math.sin(deltaLambda / 2) *
    Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

// Helper: Transform attendance data to match frontend types
const transformAttendance = (attendance: any) => {
  return {
    ...attendance.toObject(),
    checkIn: attendance.checkIn
      ? {
        time: attendance.checkIn.toISOString(),
        location: attendance.locationIn
          ? `${attendance.locationIn.lat},${attendance.locationIn.lng}`
          : undefined,
      }
      : undefined,
    checkOut: attendance.checkOut
      ? {
        time: attendance.checkOut.toISOString(),
        location: attendance.locationOut
          ? `${attendance.locationOut.lat},${attendance.locationOut.lng}`
          : undefined,
      }
      : undefined,
    workingHours:
      attendance.checkIn && attendance.checkOut
        ? Math.floor(
          (attendance.checkOut.getTime() - attendance.checkIn.getTime()) /
          (1000 * 60),
        )
        : 0,
  };
};

/**
 * Robust Profile Resolver
 * Ensures even legacy users or cross-role users (doctors/admins) have
 * a registry in the StaffProfile collection for attendance tracking.
 */
const getOrCreateStaffProfile = async (userId: string, user: any) => {
  let profile = await (StaffProfile.findOne({ user: userId }) as any)
    .unscoped()
    .populate({ path: "user", options: { unscoped: true } })
    .populate({ path: "shift", options: { unscoped: true } });

  if (!profile) {
    console.log(
      `[Attendance] Profile missing for ${user?.name || userId}. Orchestrating auto-creation...`,
    );

    const qrSecret = crypto.randomBytes(32).toString("hex");
    let hospitalId = user?.hospital;

    if (!hospitalId) {
      const defaultHospital = await Hospital.findOne();
      hospitalId = defaultHospital?._id;
    }

    // Inherit designation from role
    const role = user?.role?.trim().toLowerCase();
    let designation = "Staff Member";
    let department = "General";

    if (role === "doctor") {
      designation = "Medical Doctor";
      department = "Clinical";
    } else if (role === "nurse") {
      designation = "Nursing Staff";
      department = "Nursing";
    } else if (role === "helpdesk") {
      designation = "Patient Care Executive";
      department = "Front Desk";
    } else if (role === "discharge") {
      designation = "Discharge Coordinator";
      department = "Operations";
    } else if (role === "emergency") {
      designation = "Emergency Responder";
      department = "Emergency";
    }

    try {
      profile = await StaffProfile.create({
        user: userId,
        hospital: hospitalId,
        qrSecret,
        designation,
        department,
        status: "active",
        joiningDate: user?.createdAt || new Date(),
      });
      console.log(
        `[Attendance] Successfully auto-provisioned profile for ${user?.name}`,
      );

      // Re-populate if needed
      profile = await StaffProfile.findById(profile._id).populate("shift");
    } catch (err) {
      console.error(`[Attendance] Profile auto-provisioning failed:`, err);
      throw new Error("Unable to initialize attendance profile system");
    }
  }

  return profile;
};

export const checkIn = async (req: Request, res: Response) => {
  try {
    const { lat, lng, qrToken, photo, capturedPhoto, photoIn } = req.body || {};
    const photoData = photo || capturedPhoto || photoIn || null;
    const userId = (req as any).user._id;
    const hospitalId = (req as any).hospitalId || (req as any).user.hospital;

    let locationWarning: string | null = null;
    if (!lat || !lng) {
      return res.status(400).json({
        message: "Location permission is required for attendance clock-in. Please enable location on your device."
      });
    }

    // 1. Get Staff Profile (with auto-provisioning)
    const staffProfile = await getOrCreateStaffProfile(
      userId,
      (req as any).user,
    );
    if (!staffProfile)
      return res
        .status(404)
        .json({ message: "Staff profile could not be initialized" });

    // Exhaustive Shift Resolution
    let startTime =
      staffProfile.workingHours?.start || staffProfile.shiftStart || "09:00";
    let endTime =
      staffProfile.workingHours?.end || staffProfile.shiftEnd || "17:00";
    let shiftName = "General";

    if (staffProfile.shift) {
      let shiftDoc: any = null;
      if (
        typeof staffProfile.shift === "object" &&
        "name" in staffProfile.shift
      ) {
        shiftDoc = staffProfile.shift;
      } else {
        shiftDoc = await Shift.findById(staffProfile.shift);
      }

      if (shiftDoc) {
        startTime = shiftDoc.startTime;
        endTime = shiftDoc.endTime;
        shiftName = shiftDoc.name;
      }
    }

    // 2. Verify QR Token
    if (qrToken && staffProfile.qrSecret !== qrToken) {
      return res.status(401).json({ message: "Invalid QR verification" });
    }

    // 3. Strict Geofence Verification (500 meters max radius)
    if (lat && lng) {
      const hospital = await Hospital.findById(hospitalId);
      if (hospital && hospital.location && hospital.location.lat && hospital.location.lng) {
        const distance = getDistance(
          lat,
          lng,
          hospital.location.lat,
          hospital.location.lng,
        );
        if (distance > 500) {
          const distanceInKm = (distance / 1000).toFixed(2);
          console.warn(`[Attendance] Blocked clock-in: user ${userId} is ${Math.round(distance)}m away from hospital.`);
          return res.status(400).json({
            message: `Attendance Rejected: You are ${Math.round(distance)}m (${distanceInKm} km) away from the hospital. Clock-in is strictly allowed within 500m of the hospital premises.`
          });
        }
      }
    }

    // 4. Calculate Shift Status and Enforcement
    const { realNow, logicalNow, today } = getHospitalContext();
    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);

    const shiftStart = new Date(logicalNow);
    shiftStart.setHours(startH, startM, 0, 0);

    const shiftEnd = new Date(logicalNow);
    shiftEnd.setHours(endH, endM, 0, 0);

    // If shift end is before shift start, it's an overnight shift
    if (shiftEnd < shiftStart) {
      shiftEnd.setDate(shiftEnd.getDate() + 1);
    }

    // Cutoff: Relaxed to allow late check-ins until end of day (23:59)
    let attendanceCutoff = new Date(shiftEnd);
    attendanceCutoff.setHours(23, 59, 59, 999);

    // For Morning shifts, specifically allow until at least 7 PM if shift ends earlier
    if (
      shiftName.toLowerCase().includes("morning") &&
      attendanceCutoff.getHours() < 19
    ) {
      attendanceCutoff.setHours(19, 0, 0, 0);
    }

    // Restriction: Cannot check-in if shift/attendance period is over
    if (logicalNow > attendanceCutoff) {
      console.warn(`[Attendance] Blocked check-in for ${userId}: shift ${shiftName} closed. Now(IST): ${logicalNow.toISOString()}, Cutoff(IST): ${attendanceCutoff.toISOString()}`);
      return res.status(403).json({
        message: `${shiftName} attendance is closed for today. Access denied.`,
        shiftEnd: "23:59",
      });
    }

    // Buffer: More flexible early check-in (2 hours before shift starts)
    const earlyBuffer = new Date(shiftStart.getTime() - 120 * 60000);
    if (logicalNow < earlyBuffer) {
      console.warn(`[Attendance] Blocked check-in for ${userId}: window not open. Now(IST): ${logicalNow.toISOString()}, Buffer(IST): ${earlyBuffer.toISOString()}`);
      return res.status(403).json({
        message: `Check-in window not open yet. ${shiftName} shift starts at ${startTime}`,
        shiftStart: startTime,
      });
    }

    let status: "present" | "late" = "present";
    // Mark as late if 15 mins after shift starts
    const lateBuffer = new Date(shiftStart.getTime() + 15 * 60000);
    if (logicalNow > lateBuffer) {
      status = "late";
    }

    // 5. Save Attendance
    console.log(`[Attendance] Check-in process: User=${userId}, Hospital=${hospitalId || 'N/A'}, Time=${realNow.toISOString()}, Date=${today.toISOString()}, Status=${status}`);

    const attendance = await Attendance.findOneAndUpdate(
      { user: userId, date: today },
      {
        user: userId,
        hospital: hospitalId,
        date: today,
        checkIn: realNow,
        checkOut: null, // Reset checkOut in case re-clocking in during valid shift
        locationIn: { lat, lng },
        photoIn: photoData,
        shiftName,
        shiftStart: startTime,
        shiftEnd: endTime,
        status,
        isAutoClockOut: false,
        isQrVerified: true,
      },
      { upsert: true, new: true },
    );

    res.status(200).json({
      message: "Checked in successfully",
      attendance: transformAttendance(attendance),
      status,
      warning: locationWarning
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const checkOut = async (req: Request, res: Response) => {
  try {
    const { lat, lng, qrToken, photo, capturedPhoto, photoOut } = req.body || {};
    const photoData = photo || capturedPhoto || photoOut || null;
    const userId = (req as any).user._id;
    const hospitalId = (req as any).hospitalId || (req as any).user.hospital;

    if (!lat || !lng) {
      return res.status(400).json({
        message: "Location permission is required for attendance clock-out."
      });
    }

    // Strict Geofence Check for Check-out (500m radius)
    const hospital = await Hospital.findById(hospitalId);
    if (hospital && hospital.location && hospital.location.lat && hospital.location.lng) {
      const distance = getDistance(
        lat,
        lng,
        hospital.location.lat,
        hospital.location.lng,
      );
      if (distance > 500) {
        const distanceInKm = (distance / 1000).toFixed(2);
        return res.status(400).json({
          message: `Attendance Check-out Failed: You are ${Math.round(distance)}m (${distanceInKm} km) away from the hospital. Check-out is strictly allowed within 500m of the hospital premises.`
        });
      }
    }

    const { realNow, today } = getHospitalContext();

    console.log(`[Attendance] Check-out attempt: User=${userId}, Hospital=${hospitalId || 'N/A'}, Time=${realNow.toISOString()}, Date=${today.toISOString()}`);

    // Find today's attendance record
    const existingAttendance = await Attendance.findOne({
      user: userId,
      date: today,
    });
    if (!existingAttendance || !existingAttendance.checkIn) {
      console.warn(`[Attendance] Check-out failed for ${userId}: No check-in record for ${today.toISOString()}`);
      return res.status(404).json({
        message:
          "Check-in record not found for today. You must check-in first.",
      });
    }

    if (existingAttendance.checkOut && !existingAttendance.isAutoClockOut) {
      return res
        .status(400)
        .json({ message: "You have already checked out for today." });
    }

    // Calculate hours worked
    const checkInTime = new Date(existingAttendance.checkIn);
    const hoursWorked =
      (realNow.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);

    const attendance = await Attendance.findOneAndUpdate(
      { user: userId, date: today },
      {
        checkOut: realNow,
        locationOut: { lat, lng },
        photoOut: photoData,
        isAutoClockOut: false,
      },
      { new: true },
    );

    console.log(`[Attendance] Check-out successful: User=${userId}, Hours=${hoursWorked.toFixed(2)}`);

    res.status(200).json({
      message: "Checked out successfully",
      attendance: transformAttendance(attendance),
      hoursWorked: hoursWorked.toFixed(2),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getHospitalAttendanceStats = async (
  req: Request,
  res: Response,
) => {
  try {
    const requester = (req as any).user;
    let hospitalId = (req as any).hospitalId || requester?.hospital;

    // Fallback for roles that might only have hospital in StaffProfile
    if (!hospitalId) {
      const profile = await StaffProfile.findOne({
        user: requester?._id || requester?.id,
      })
        .select("hospital")
        .lean();
      if (profile) hospitalId = profile.hospital;
    }

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID not found" });
    }

    // Use optimized service for stats
    const stats = await staffService.getDashboardStats(hospitalId!.toString());

    const { today } = getHospitalContext();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Calculate absentCount
    const absentCount = Math.max(
      0,
      stats.totalStaff - (stats.presentToday + stats.lateToday + stats.onLeave),
    );

    // Calculate average attendance for the month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const daysPassed = today.getDate();

    const monthAttendanceCount = await Attendance.countDocuments({
      hospital: hospitalId,
      date: { $gte: startOfMonth, $lt: tomorrow },
      status: { $in: ["present", "late"] },
    });

    const averageAttendance =
      stats.totalStaff > 0 && daysPassed > 0
        ? Math.round(
          (monthAttendanceCount / (stats.totalStaff * daysPassed)) * 100,
        )
        : 0;

    // Calculate Weekly Trend - Optimized with single aggregate call
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const trendCounts = await Attendance.aggregate([
      {
        $match: {
          hospital: new mongoose.Types.ObjectId(hospitalId),
          date: { $gte: sevenDaysAgo, $lt: tomorrow },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const last7Days: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];

      const dayStats: any = {
        name: d.toLocaleDateString("en-US", { weekday: "short" }),
        present: 0,
        late: 0,
      };

      trendCounts.forEach((c) => {
        if (c._id.date === dateStr) {
          if (c._id.status === "present") dayStats.present = c.count;
          if (c._id.status === "late") dayStats.late = c.count;
        }
      });

      last7Days.push(dayStats);
    }

    res.status(200).json({
      stats: {
        totalStaff: stats.totalStaff,
        today: {
          present: stats.presentToday,
          late: stats.lateToday,
          onLeave: stats.onLeave,
          absent: absentCount,
        },
        averageAttendance,
        trend: last7Days,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getMonthlyReport = async (req: Request, res: Response) => {
  try {
    const { month, date, status, staffId } = req.query;
    const hospitalId = (req as any).user.hospital;

    if (!hospitalId) {
      return res
        .status(400)
        .json({ message: "Hospital ID not found in session" });
    }

    const hId = new mongoose.Types.ObjectId(hospitalId as string);
    let query: any = { hospital: hId };

    if (date) {
      const startDate = new Date(date as string);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      query.date = { $gte: startDate, $lt: endDate };
    } else if (month) {
      const start = new Date((month as string) + "-01");
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      query.date = { $gte: start, $lt: end };
    } else if (req.query.startDate && req.query.endDate) {
      const start = new Date(req.query.startDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(req.query.endDate as string);
      end.setHours(23, 59, 59, 999);
      query.date = { $gte: start, $lte: end };
    }

    if (staffId) query.user = staffId;

    // 1. Get all active personnel (Doctors, Nurses, Staff, Helpdesk, etc.)
    const personnel = await User.find({
      hospital: hId,
      role: {
        $in: ["staff", "doctor", "nurse", "emergency", "DISCHARGE", "helpdesk"],
      },
      status: "active",
    })
      .select("name email role mobile")
      .lean();

    const personnelIds = personnel.map((u) => u._id.toString());
    const staffProfiles = await StaffProfile.find({
      user: { $in: personnelIds },
    }).lean();

    const staffProfileMap = new Map();
    staffProfiles.forEach((p) => {
      staffProfileMap.set(p.user.toString(), p);
    });

    // 2. Identify the target date for roster comparison
    let targetDate: Date | null = null;
    if (date) {
      targetDate = new Date(date as string);
      targetDate.setHours(0, 0, 0, 0);
    }

    const records = await Attendance.find(query)
      .populate("user", "name email mobile role")
      .sort({ date: -1 })
      .lean();

    // 3. Transform existing records
    const transformedRecords = records
      .filter((rec) => rec.user)
      .map((rec) => {
        const userObj = rec.user as any;
        const staffProfile = staffProfileMap.get(userObj._id.toString());

        let workingHours = 0;
        if (rec.checkIn && rec.checkOut) {
          workingHours = Math.floor(
            (new Date(rec.checkOut).getTime() -
              new Date(rec.checkIn).getTime()) /
            (1000 * 60),
          );
        }

        return {
          _id: rec._id,
          date: rec.date,
          status: rec.status,
          checkIn: rec.checkIn ? { time: rec.checkIn, method: "Portal" } : null,
          checkOut: rec.checkOut
            ? { time: rec.checkOut, method: "Portal" }
            : null,
          photoIn: (rec as any).photoIn || null,
          photoOut: (rec as any).photoOut || null,
          isAutoClockOut: (rec as any).isAutoClockOut || false,
          locationIn: (rec as any).locationIn || null,
          locationOut: (rec as any).locationOut || null,
          workingHours,
          staff: {
            user: {
              _id: userObj._id,
              name: userObj.name || "Unknown",
              email: userObj.email || "",
              role: userObj.role,
            },
            employeeId: staffProfile?.employeeId || null,
            designation:
              staffProfile?.designation ||
              userObj.role?.toUpperCase() ||
              "Staff Member",
          },
        };
      });

    let finalResult: any[] = transformedRecords;

    // 4. Fill in the blanks if a specific date is requested
    if (targetDate) {
      const existingUserIds = new Set(
        transformedRecords.map((r) => r.staff.user._id.toString()),
      );

      // Get all leaves for this day and index requesterIds for O(1) lookup
      const dayLeaves = await Leave.find({
        hospital: hId,
        status: "approved",
        startDate: { $lte: targetDate },
        endDate: { $gte: targetDate },
      }).lean();

      const leaveUserIds = new Set(
        dayLeaves.map((l) => l.requester.toString()),
      );

      for (const person of personnel) {
        const userIdStr = person._id.toString();
        if (existingUserIds.has(userIdStr)) {
          continue;
        }

        const profile = staffProfileMap.get(userIdStr);

        // Get day name for weekly off check
        const dayName = targetDate.toLocaleDateString("en-US", {
          weekday: "long",
        });
        const isWeeklyOff = profile?.weeklyOff?.includes(dayName);

        // Check if they are on leave
        const isOnLeave = leaveUserIds.has(userIdStr);

        let computedStatus: any = "absent";
        if (isOnLeave) computedStatus = "on-leave";
        else if (isWeeklyOff) computedStatus = "off-duty";

        finalResult.push({
          _id: `v-${userIdStr}-${date || "today"}`, // Virtual ID
          date: targetDate,
          status: computedStatus,
          checkIn: null,
          checkOut: null,
          workingHours: 0,
          staff: {
            user: {
              _id: person._id,
              name: person.name || "Unknown",
              email: person.email || "",
              role: person.role,
            },
            employeeId: profile?.employeeId || "EMP-N/A",
            designation:
              profile?.designation ||
              person.role?.toUpperCase() ||
              "Staff Member",
          },
        });
      }
    }

    // 5. Final Filtering (Post-processing for virtual records)
    if (status) {
      const statusFilter = String(status).toLowerCase();
      finalResult = finalResult.filter(
        (r) => String(r.status).toLowerCase() === statusFilter,
      );
    }

    if (staffId) {
      const sid = String(staffId);
      finalResult = finalResult.filter((r) => {
        const rUserId =
          r.staff?.user?._id?.toString() || r.staff?.user?.toString() || "";
        return rUserId === sid;
      });
    }

    res.status(200).json({ attendance: finalResult });
  } catch (error: any) {
    console.error("Error in getMonthlyReport:", error);
    res.status(500).json({
      message: error.message || "Failed to generate attendance report",
    });
  }
};

export const getTodayAttendance = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const { today } = getHospitalContext();

    const attendance = await Attendance.findOne({
      user: userId,
      date: today,
    });

    res.status(200).json({
      attendance: attendance ? transformAttendance(attendance) : null,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getSelfAttendance = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const { limit = 10, page = 1, month, year } = req.query;

    let query: any = { user: userId };

    if (month && year) {
      const m = Number(month);
      const y = Number(year);
      const startDate = new Date(y, m - 1, 1);
      const endDate = new Date(y, m, 0, 23, 59, 59, 999);
      query.date = { $gte: startDate, $lte: endDate };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const attendanceRecords = await Attendance.find(query)
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Attendance.countDocuments(query);

    const transformedAttendance = attendanceRecords.map(transformAttendance);

    res.status(200).json({
      attendance: transformedAttendance,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (error: any) {
    console.error("[API Error] getSelfAttendance:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getStaffDashboard = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;

    // 1. Get Staff Profile
    const staffProfile = await (StaffProfile.findOne({ user: userId }) as any)
      .unscoped()
      .populate({
        path: "user",
        select: "name email mobile role avatar image gender dateOfBirth",
        options: { unscoped: true },
      })
      .populate({
        path: "hospital",
        select: "name address",
        options: { unscoped: true },
      })
      .populate({ path: "shift", options: { unscoped: true } });

    if (!staffProfile) {
      // Fallback for doctors or admins who might not have a full StaffProfile but are accessing this page
      const user = (req as any).user;
      return res.status(200).json({
        staff: {
          user: {
            name: user.name,
            email: user.email,
            mobile: user.mobile,
            role: user.role,
          },
          hospital: { name: "System Hospital" }, // Default fallback
          designation: user.role.toUpperCase(),
        },
        todayAttendance: null,
        stats: {
          presentDays: 0,
          totalDays: 1,
          onTimePercentage: 100,
          averageHours: 0,
        },
      });
    }

    // 2. Get Today's Attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayAttendanceRecord = await Attendance.findOne({
      user: userId,
      date: today,
    });

    // 3. Get Leave Stats
    const pendingLeaves = await Leave.find({
      requester: userId,
      status: "pending",
    });
    const leaveStats = {
      pending: pendingLeaves.length,
      types: pendingLeaves.reduce((acc: any, curr) => {
        acc[curr.leaveType] = (acc[curr.leaveType] || 0) + 1;
        return acc;
      }, {}),
    };

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const totalDaysInMonth = new Date().getDate();
    const monthlyAttendance = await Attendance.find({
      user: userId,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const presentDays = monthlyAttendance.filter(
      (a) => a.status === "present" || a.status === "late",
    ).length;
    const absentDays = monthlyAttendance.filter(
      (a) => a.status === "absent",
    ).length;
    const onLeaveDays = monthlyAttendance.filter(
      (a) => a.status === "on-leave",
    ).length;
    const lateDays = monthlyAttendance.filter(
      (a) => a.status === "late",
    ).length;

    const onTimeDays = monthlyAttendance.filter(
      (a) => a.status === "present",
    ).length;
    const onTimePercentage =
      presentDays > 0 ? Math.round((onTimeDays / presentDays) * 100) : 100;

    let totalWorkingMinutes = 0;
    monthlyAttendance.forEach((a) => {
      if (a.checkIn && a.checkOut) {
        totalWorkingMinutes +=
          (new Date(a.checkOut).getTime() - new Date(a.checkIn).getTime()) /
          (1000 * 60);
      }
    });
    const averageHours =
      presentDays > 0
        ? Math.round((totalWorkingMinutes / 60 / presentDays) * 10) / 10
        : 0;

    // Multi-Layered Shift Resolution
    let resolvedShift = {
      name: "General",
      startTime:
        staffProfile.workingHours?.start || staffProfile.shiftStart || "09:00",
      endTime:
        staffProfile.workingHours?.end || staffProfile.shiftEnd || "17:00",
      shiftId: "default",
    };

    // 1. Check if shift is assigned and populated/available
    const assignedShiftId = staffProfile.shift;
    if (assignedShiftId) {
      let shiftData: any = null;

      // If already populated by mongoose
      if (
        typeof assignedShiftId === "object" &&
        "name" in (assignedShiftId as any)
      ) {
        shiftData = assignedShiftId;
      } else {
        // Secondary force-lookup
        shiftData = await Shift.findById(assignedShiftId);
      }

      if (shiftData) {
        resolvedShift = {
          name: shiftData.name,
          startTime: shiftData.startTime,
          endTime: shiftData.endTime,
          shiftId: shiftData._id.toString(),
        };
      }
    }

    // 2. Prepare Final Staff Payload
    const staffPayload = staffProfile.toObject() as any;
    staffPayload.resolvedShift = resolvedShift;

    if (
      staffPayload.user &&
      (staffPayload.user.avatar || staffPayload.user.image)
    ) {
      staffPayload.user.image =
        staffPayload.user.avatar || staffPayload.user.image;
    }

    res.status(200).json({
      staff: staffPayload,
      todayAttendance: todayAttendanceRecord
        ? transformAttendance(todayAttendanceRecord)
        : null,
      stats: {
        presentDays,
        absentDays,
        onLeaveDays,
        lateDays,
        pendingLeaves: leaveStats.pending,
        leaveTypeBreakdown: leaveStats.types,
        totalDays: totalDaysInMonth,
        onTimePercentage,
        averageHours: averageHours.toString(),
        leaveQuota:
          (staffProfile.sickLeaveQuota || 0) +
          (staffProfile.emergencyLeaveQuota || 0),
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getSelfPayroll = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const { month, year } = req.query;

    // 1. Get Staff Profile for salary structure
    const staffProfile = await StaffProfile.findOne({ user: userId });

    // 2. Fetch processed payroll records if any
    const payrollQuery: any = { user: userId };
    if (month) payrollQuery.month = Number(month);
    if (year) payrollQuery.year = Number(year);

    const realPayrolls = await Payroll.find(payrollQuery).sort({
      year: -1,
      month: -1,
    });

    // 3. Calculate Attendance Summary for current context
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const attendance = await Attendance.find({
      user: userId,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const summary = {
      totalDays: attendance.length,
      presentDays: attendance.filter(
        (a) => a.status === "present" || a.status === "late",
      ).length,
      totalHours: attendance.reduce((acc, curr) => {
        if (curr.checkIn && curr.checkOut) {
          return (
            acc +
            (curr.checkOut.getTime() - curr.checkIn.getTime()) /
            (1000 * 60 * 60)
          );
        }
        return acc;
      }, 0),
    };

    // If real records exist, return them
    if (realPayrolls.length > 0) {
      return res.status(200).json({
        payroll: realPayrolls,
        attendanceSummary: summary,
      });
    }

    // 4. Default / Fallback: Return dynamic projection based on Profile
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const base = staffProfile?.baseSalary || 0;
    const totalAllowances = (staffProfile?.allowances || []).reduce(
      (acc, curr) => acc + (curr.amount || 0),
      0,
    );
    const totalDeductions = (staffProfile?.deductions || []).reduce(
      (acc, curr) => acc + (curr.amount || 0),
      0,
    );

    const payroll = [
      {
        id: "projected-current",
        month: months[now.getMonth()],
        year: now.getFullYear(),
        paidAt: null,
        baseSalary: base,
        allowances: totalAllowances,
        deductions: totalDeductions,
        netPay: base + totalAllowances - totalDeductions,
        status: "draft",
      },
    ];

    res.status(200).json({
      payroll,
      attendanceSummary: summary,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getStaffSchedule = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;

    let staffProfile = await StaffProfile.findOne({ user: userId }).populate(
      "shift",
    );

    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const monthlyAttendance = await Attendance.find({
      user: userId,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const presentDays = monthlyAttendance.filter(
      (a) => a.status === "present" || a.status === "late",
    ).length;
    const absentDays = monthlyAttendance.filter(
      (a) => a.status === "absent",
    ).length;
    const onLeaveDays = monthlyAttendance.filter(
      (a) => a.status === "on-leave" || a.status === "half-day",
    ).length;

    const onTimeDays = monthlyAttendance.filter(
      (a) => a.status === "present",
    ).length;
    const onTimePercentage =
      presentDays > 0 ? Math.round((onTimeDays / presentDays) * 100) : 100;

    // Get Leave Stats
    const pendingLeaves = await Leave.countDocuments({
      requester: userId,
      status: "pending",
    });

    // ✅ DYNAMIC SYNC: Fetch all approved leaves for the requester so calendar is populated correctly across all months
    const approvedLeaves = await Leave.find({
      requester: userId,
      status: "approved",
    }).lean();

    // Exhaustive Shift Resolution
    let resolvedShift = {
      name: "General",
      startTime:
        staffProfile?.workingHours?.start ||
        staffProfile?.shiftStart ||
        "09:00",
      endTime:
        staffProfile?.workingHours?.end || staffProfile?.shiftEnd || "17:00",
      shiftId: "default",
    };

    if (staffProfile?.shift) {
      let shiftDoc: any = null;
      // Check if it's already populated or if we need to fetch it
      if (
        typeof staffProfile.shift === "object" &&
        "name" in (staffProfile.shift as any)
      ) {
        shiftDoc = staffProfile.shift;
      } else {
        // Manual fetch if populate failed for some reason
        shiftDoc = await Shift.findById(staffProfile.shift);
      }

      if (shiftDoc) {
        resolvedShift = {
          name: shiftDoc.name,
          startTime: shiftDoc.startTime,
          endTime: shiftDoc.endTime,
          shiftId: shiftDoc._id.toString(),
        };
      }
    }

    const schedule = {
      shift: resolvedShift.name,
      shiftId: resolvedShift.shiftId,
      startTime: resolvedShift.startTime,
      endTime: resolvedShift.endTime,
      workingHours: {
        start: resolvedShift.startTime,
        end: resolvedShift.endTime,
      },
      weeklyOff: staffProfile?.weeklyOff || ["Sunday"],
      employmentType: staffProfile?.employmentType || "full-time",
      stats: {
        presentDays,
        absentDays,
        onLeaveDays,
        onTimePercentage,
        pendingLeaves,
      },
    };

    res.status(200).json({ schedule, approvedLeaves });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getStaffProfile = async (req: Request, res: Response) => {
  const docReq = req as any;
  try {
    const user = docReq.user!;
    const userId = user._id || user.id;

    console.log(
      `[getStaffProfile] Request for user ID: ${userId}, Name: ${user.name}, Role: ${user.role}`,
    );

    const staffProfile = await getOrCreateStaffProfile(userId, user);

    console.log(
      `[getStaffProfile] Found profile: ${staffProfile._id}. Populating and converting to object...`,
    );
    const staffObj = staffProfile.toObject() as any;

    console.log(`[getStaffProfile] Decrypting profile object for ${userId}...`);
    const decryptedProfile = decryptObject(staffObj);

    console.log(
      `[getStaffProfile] Successfully prepared profile for ${userId}`,
    );
    res.status(200).json({ staff: decryptedProfile });
  } catch (err) {
    console.error("getStaffProfile error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getSelfStaffProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    // FIX: Removed .lean() — it was bypassing Mongoose post-hooks (decrypt hooks),
    // AND causing a runtime TypeError because .toObject() does not exist on plain JS objects.
    // Without .lean(), Mongoose returns a document instance, post-hooks decrypt fields,
    // and .toObject() works correctly.
    const staffProfile = await (StaffProfile.findOne({ user: userId }) as any)
      .unscoped()
      .populate({ path: "user", options: { unscoped: true } })
      .populate({ path: "shift", options: { unscoped: true } });

    if (!staffProfile) {
      return res.status(404).json({ message: "Staff profile not found" });
    }

    const staffObj = staffProfile.toObject() as any;
    res.status(200).json({ staff: staffObj });
  } catch (err) {
    console.error("getSelfStaffProfile error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateStaffProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const updates = req.body || {};

    // 1. Separate User-level fields
    const userFields = ["name", "email", "mobile", "gender", "dateOfBirth"];
    const userUpdates: any = {};
    userFields.forEach((f) => {
      if (updates[f] !== undefined) userUpdates[f] = updates[f];
    });

    if (updates.profilePic || updates.image) {
      userUpdates.image = updates.profilePic || updates.image;
      userUpdates.avatar = updates.profilePic || updates.image; // Mirror for compatibility
    }

    if (Object.keys(userUpdates).length > 0) {
      await (
        User.findByIdAndUpdate(userId, { $set: userUpdates }) as any
      ).unscoped();
    }

    const staffFields = [
      "department",
      "designation",
      "employeeId",
      "employmentType",
      "experienceYears",
      "joiningDate",
      "address",
      "emergencyContact",
      "shift",
      "workingHours",
      "weeklyOff",
      "qualifications",
      "certifications",
      "skills",
      "bloodGroup",
      "languages",
      "notes",
      "bio",
      "baseSalary",
      "panNumber",
      "pfNumber",
      "esiNumber",
      "uanNumber",
      "aadharNumber",
      "fatherName",
      "workLocation",
      "bankDetails",
      "documents",
    ];

    const staffUpdates: any = {};
    staffFields.forEach((f) => {
      if (updates[f] !== undefined) {
        let value = updates[f];

        // Robust parsing for fields that might be stringified JSON (FormData behavior)
        const arrayFields = [
          "department",
          "qualifications",
          "certifications",
          "skills",
          "languages",
          "weeklyOff",
        ];
        const objectFields = [
          "address",
          "emergencyContact",
          "workingHours",
          "bankDetails",
        ];

        try {
          if (
            typeof value === "string" &&
            (arrayFields.includes(f) || objectFields.includes(f))
          ) {
            if (value.startsWith("[") || value.startsWith("{")) {
              value = JSON.parse(value);
            }
          }

          // Further sanitization for arrays to prevent double-stringification or corruption
          if (
            arrayFields.includes(f) &&
            (Array.isArray(value) || typeof value === "string")
          ) {
            let finalArray: string[] = [];
            if (Array.isArray(value)) {
              // Flatten and clean: some items might be stringified JSON or comma-separated
              value.forEach((item) => {
                if (typeof item === "string") {
                  if (item.startsWith("[") && item.endsWith("]")) {
                    try {
                      const parsed = JSON.parse(item);
                      if (Array.isArray(parsed)) finalArray.push(...parsed);
                      else finalArray.push(parsed);
                    } catch {
                      finalArray.push(item);
                    }
                  } else {
                    finalArray.push(
                      ...item
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    );
                  }
                } else {
                  finalArray.push(String(item));
                }
              });
            } else if (typeof value === "string") {
              finalArray = value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            }
            // Remove duplicates and save
            value = [...new Set(finalArray)];
          }
        } catch (e) {
          console.warn(`[updateStaffProfile] Failed to parse field ${f}:`, e);
        }

        staffUpdates[f] = value;
      }
    });

    // Qualification Details (Handle as Object)
    if (updates.qualificationDetails) {
      const qDetails =
        typeof updates.qualificationDetails === "string"
          ? JSON.parse(updates.qualificationDetails)
          : updates.qualificationDetails;
      staffUpdates.qualificationDetails = qDetails;
    } else if (updates.registrationNumber || updates.licenseValidityDate) {
      // Flat field support from frontend if needed
      staffUpdates.qualificationDetails = {
        registrationNumber: updates.registrationNumber,
        licenseValidityDate: updates.licenseValidityDate,
      };
    }

    // ✅ RE-ARM: Reset alert flags if the date has changed
    if (staffUpdates.qualificationDetails?.licenseValidityDate) {
      staffUpdates.expiryAlertsSent = {
        thirtyDay: false,
        sevenDay: false,
        oneDay: false,
        expired: false,
      };
    }

    // Start with existing documents
    const existingStaff = await (
      StaffProfile.findOne({ user: userId }) as any
    ).unscoped();
    let currentDocs = existingStaff?.documents || {};

    // 🔴 Handle Document Deletion requests 
    if (updates.delete_document) {
      if (currentDocs[updates.delete_document]) {
        currentDocs[updates.delete_document] = null;
        staffUpdates.documents = currentDocs; // Assign to updates map to send over Mongoose update
      }
    }

    // Handle File Uploads (Profile Pic & Documents)
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      const files = req.files as Express.Multer.File[];
      const docFields = [
        "degreeCertificate",
        "medicalCouncilRegistration",
        "nursingCouncilRegistration",
        "doctorateCertificate",
        "internshipCertificate",
      ];
      const photoFields = ["profilePic", "image"];

      const documentUpdates: any = {};
      let profilePicUrl = "";

      for (const file of files) {
        // Handle Profile Photo
        if (
          photoFields.some(
            (pf) => file.fieldname === pf || file.fieldname.includes(pf),
          )
        ) {
          const publicId = `avatars/${userId}_${Date.now()}`;
          const result = await uploadToCloudinary(file.buffer, {
            public_id: publicId,
            folder: "avatars",
          });
          profilePicUrl = result.secure_url;

          // Update User model immediately
          await (
            User.findByIdAndUpdate(userId, {
              $set: {
                image: profilePicUrl,
                avatar: profilePicUrl,
              },
            }) as any
          ).unscoped();

          userUpdates.image = profilePicUrl;
          userUpdates.avatar = profilePicUrl;
        }

        // Handle Documents
        const docField = docFields.find(
          (df) => file.fieldname === df || file.fieldname.includes(df),
        );
        if (docField) {
          const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
          const resourceType = isPdf ? "raw" : "image";
          const folderName = (req as any).user.role === "nurse" ? "nurse_docs" : "staff_docs";
          const publicId = `${folderName}/${userId}_${docField}_${Date.now()}`;

          const result = await uploadToCloudinary(file.buffer, {
            public_id: publicId,
            folder: folderName,
            resource_type: resourceType,
            access_mode: "public",
          });
          documentUpdates[docField] = {
            url: result.secure_url,
            publicId: result.public_id,
            name: file.originalname,
            size: file.size,
          };
        }
      }

      if (Object.keys(documentUpdates).length > 0) {
        staffUpdates.documents = { ...currentDocs, ...documentUpdates };
      }
    }

    // Mirror personal fields if they exist in StaffProfile too
    if (updates.gender) staffUpdates.gender = updates.gender;
    if (updates.dateOfBirth) staffUpdates.dob = updates.dateOfBirth;

    const updatedProfile = await (
      StaffProfile.findOneAndUpdate(
        { user: userId },
        { $set: staffUpdates },
        { new: true, upsert: true },
      ) as any
    )
      .unscoped()
      .populate({ path: "user", options: { unscoped: true } })
      .populate({ path: "shift", options: { unscoped: true } });

    // ✅ INSTANT ALERT: Check and notify immediately if date is close/expired
    if (
      updatedProfile &&
      updatedProfile.qualificationDetails?.licenseValidityDate
    ) {
      await processSingleProfileExpiry(updatedProfile);
    }

    // Convert to plain object to avoid infinite recursion in decryptObject (Mongoose docs are circular)
    const staffObj = updatedProfile.toObject() as any;

    res.status(200).json({ success: true, staff: decryptObject(staffObj) });
  } catch (error: any) {
    console.error("[updateStaffProfile] Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAttendanceSummary = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user.hospital;
    if (!hospitalId)
      return res
        .status(400)
        .json({ message: "Hospital ID not found in session" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0);

    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);

    // Days elapsed
    const daysInMonthElapsed = today.getDate();
    const diffYear = today.getTime() - startOfYear.getTime();
    const daysInYearElapsed = Math.floor(diffYear / (1000 * 60 * 60 * 24)) + 1;

    // 1. Get all active personnel (Doctors, Nurses, Staff, Discharge, Helpdesk/Frontdesk)
    const personnel = await User.find({
      hospital: hospitalId,
      role: {
        $in: ["staff", "doctor", "nurse", "emergency", "DISCHARGE", "helpdesk"],
      },
      status: "active",
    })
      .select("name email role mobile")
      .lean();

    const personnelIds = personnel.map((u) => u._id.toString());
    const staffProfiles = await StaffProfile.find({
      user: { $in: personnelIds },
    }).lean();

    const staffProfileMap = new Map();
    staffProfiles.forEach((p) => staffProfileMap.set(p.user.toString(), p));

    if (!personnel.length) {
      console.log(
        `[getAttendanceSummary] No personnel found for hospital: ${hospitalId}`,
      );
      return res.status(200).json({ summary: [] });
    }

    const userIds = personnel.map((p) => p._id);
    const userObjIds = userIds.map((id) => new mongoose.Types.ObjectId(id));

    // 2. Aggregate counts in parallel
    const [
      todayAttendance,
      monthlyAttendance,
      yearlyAttendance,
      monthlyLeaves,
      yearlyLeaves,
    ] = await Promise.all([
      Attendance.find({
        hospital: hospitalId,
        date: today,
        user: { $in: userIds },
      }).lean(),

      Attendance.aggregate([
        {
          $match: {
            hospital: new mongoose.Types.ObjectId(hospitalId),
            date: { $gte: startOfMonth, $lte: endOfMonth },
            user: { $in: userObjIds },
            status: { $in: ["present", "late", "half-day"] },
          },
        },
        { $group: { _id: "$user", count: { $sum: 1 } } },
      ]),

      Attendance.aggregate([
        {
          $match: {
            hospital: new mongoose.Types.ObjectId(hospitalId),
            date: { $gte: startOfYear, $lte: endOfYear },
            user: { $in: userObjIds },
            status: { $in: ["present", "late", "half-day"] },
          },
        },
        { $group: { _id: "$user", count: { $sum: 1 } } },
      ]),

      Leave.find({
        hospital: hospitalId,
        status: "approved",
        requester: { $in: userIds },
        startDate: { $lte: endOfMonth },
        endDate: { $gte: startOfMonth },
      }).lean(),

      Leave.find({
        hospital: hospitalId,
        status: "approved",
        requester: { $in: userIds },
        startDate: { $lte: endOfYear },
        endDate: { $gte: startOfYear },
      }).lean(),
    ]);

    // Helper to calculate leave days in a range
    const calculateLeaveDaysInRange = (
      leave: any,
      rangeStart: Date,
      rangeEnd: Date,
    ) => {
      const start =
        new Date(leave.startDate) > rangeStart
          ? new Date(leave.startDate)
          : rangeStart;
      const end =
        new Date(leave.endDate) < rangeEnd ? new Date(leave.endDate) : rangeEnd;
      const diffTime = Math.abs(end.getTime() - start.getTime());
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    };

    // 3. Enrich Summary
    const summary = personnel.map((person) => {
      const userId = person._id.toString();
      const profile = staffProfileMap.get(userId);

      const todayRec = todayAttendance.find(
        (a) => a.user.toString() === userId,
      );
      const monthAtt =
        monthlyAttendance.find((c) => c._id.toString() === userId)?.count || 0;
      const yearAtt =
        yearlyAttendance.find((c) => c._id.toString() === userId)?.count || 0;

      const monthL = monthlyLeaves
        .filter((l) => l.requester.toString() === userId)
        .reduce(
          (acc, l) => acc + calculateLeaveDaysInRange(l, startOfMonth, today),
          0,
        );

      const yearL = yearlyLeaves
        .filter((l) => l.requester.toString() === userId)
        .reduce(
          (acc, l) => acc + calculateLeaveDaysInRange(l, startOfYear, today),
          0,
        );

      // Calculation based on elapsed days
      const mAbsent = Math.max(0, daysInMonthElapsed - monthAtt - monthL);
      const yAbsent = Math.max(0, daysInYearElapsed - yearAtt - yearL);

      return {
        userId,
        name: person.name || null,
        email: person.email || "",
        designation:
          profile?.designation || person.role?.toUpperCase() || "Staff Member",
        employeeId: profile?.employeeId || null, // null instead of 'N/A' placeholder
        todayStatus: todayRec
          ? todayRec.status
          : today.getDay() === 0
            ? "off-duty"
            : "absent",
        checkIn: todayRec?.checkIn || null,
        checkOut: todayRec?.checkOut || null,
        monthlyAttendedDays: monthAtt,
        monthlyAbsentDays: mAbsent,
        monthlyLeaveDays: monthL,
        yearlyAttendedDays: yearAtt,
        yearlyAbsentDays: yAbsent,
        yearlyLeaveDays: yearL,
        monthDaysTotal: daysInMonthElapsed,
        yearDaysTotal: daysInYearElapsed,
      };
    });

    res.status(200).json({ summary });
  } catch (error: any) {
    console.error("Error in getAttendanceSummary:", error);
    res.status(500).json({ message: error.message });
  }
};
