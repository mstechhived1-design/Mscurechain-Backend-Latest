import { Request, Response } from "express";
import Leave from "../Models/Leave.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
// import HelpDesk from "../../Helpdesk/Models/HelpDesk.js";
import { createNotification } from "../../Notification/Controllers/notificationController.js";
import { LeaveRequest } from "../types/index.js";
import Attendance from "../../Staff/Models/Attendance.js";

// Utility to handle status responses explicitly to avoid TS confusion
const sendStatus = (res: Response, code: number, message: string) => {
  return res.status(code).json({ message });
};

// Request Leave
export const requestLeave = async (req: Request, res: Response) => {
  const leaveReq = req as unknown as LeaveRequest;
  try {
    const { startDate, endDate, reason, leaveType } = leaveReq.body;
    const userId = (leaveReq.user as any)._id;

    // Ensure user is authorized
    const role = (leaveReq.user as any).role;
    const allowedRoles = [
      "doctor",
      "staff",
      "nurse",
      "hr",
      "hospital-admin",
      "super-admin",
    ];
    if (!allowedRoles.includes(role)) {
      return sendStatus(res, 403, "Not authorized to request leave");
    }

    // Validate Dates: Start Date cannot be after End Date. Equal dates are allowed.
    if (new Date(startDate) > new Date(endDate)) {
      return sendStatus(
        res,
        400,
        "End date must be after or equal to start date",
      );
    }

    let hospitalId = (leaveReq.user as any).hospital;
    let assignedHelpdesk;

    if (role === "doctor") {
      const doctorProfile = await (DoctorProfile.findOne({ user: userId }) as any).unscoped();
      if (!doctorProfile)
        return sendStatus(res, 404, "Doctor profile not found");
      hospitalId = doctorProfile.hospital;
      assignedHelpdesk = doctorProfile.assignedHelpdesk;
    } else if (role === "staff" || role === "nurse") {
      const staffProfile = await (
        await import("../../Staff/Models/StaffProfile.js")
      ).default.findOne({ user: userId });
      if (staffProfile) {
        hospitalId = staffProfile.hospital;
      }
    }

    const leave = await Leave.create({
      requester: userId,
      startDate,
      endDate,
      reason,
      leaveType,
      hospital: hospitalId,
      assignedHelpdesk,
    });

    // ✅ DYNAMIC SYNC: Populate requester for rich notifications
    const populatedLeave = await Leave.findById(leave._id).populate(
      "requester",
      "name role",
    );

    // Notify Hospital Admins
    if (hospitalId) {
      // Find hospital admins for this hospital
      const User = (await import("../../Auth/Models/User.js")).default;
      const hospitalAdmins = await User.find({
        role: "hospital-admin",
        hospital: hospitalId,
      });

      for (const admin of hospitalAdmins) {
        await createNotification(req, {
          hospital: hospitalId,
          recipient: admin._id,
          sender: userId,
          type: "leave_request",
          message: `New ${leaveType} leave request from ${(leaveReq.user as any).name}`,
          relatedId: leave._id,
        });
      }

      // Emit to hospital admin and hr rooms for real-time UI updates
      if ((req as any).io) {
        const adminRoom = `hospital_${hospitalId}_hospital-admin`;
        const hrRoom = `hospital_${hospitalId}_hr`;
        console.log(`📡 Emitting leave:new to rooms: ${adminRoom}, ${hrRoom}`);
        (req as any).io.to(adminRoom).to(hrRoom).emit("leave:new", {
          message: "New leave request",
          leave: populatedLeave || leave,
        });
      }
    }

    res.status(201).json({ message: "Leave requested successfully", leave });
  } catch (error) {
    console.error("Request Leave Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get Leaves
export const getLeaves = async (req: Request, res: Response) => {
  const leaveReq = req as unknown as LeaveRequest;
  try {
    const { role, _id } = leaveReq.user as any;
    let query: any = {};

    if (
      req.query.all === "true" &&
      (role === "hospital-admin" || role === "super-admin" || role === "hr")
    ) {
      if (role === "hospital-admin" || role === "hr") {
        query.hospital = (leaveReq.user as any).hospital;
      }
      // super-admin sees all hospitals if all=true
    } else {
      // Default: Isolation - only see your own record
      query.requester = _id;
    }

    const leaves = await Leave.find(query)
      .populate("requester", "name email role") // Populating the user (formerly named 'doctor')
      .sort({ createdAt: -1 });

    res.json({ leaves });
  } catch (error) {
    console.error("Get Leaves Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update Leave Status
export const updateLeaveStatus = async (req: Request, res: Response) => {
  const leaveReq = req as unknown as LeaveRequest;
  try {
    const { id } = leaveReq.params;
    const { status } = leaveReq.body;
    const { role, _id } = leaveReq.user as any;

    if (!["approved", "rejected"].includes(status)) {
      return sendStatus(res, 400, "Invalid status");
    }

    const leave: any = await Leave.findById(id);
    if (!leave) {
      return sendStatus(res, 404, "Leave request not found");
    }

    // Authorization: hospital-admin and hr can only manage requests for their hospital
    if (role === "hospital-admin" || role === "hr") {
      const adminHospitalId = (leaveReq.user as any).hospital;
      if (
        !leave.hospital ||
        leave.hospital.toString() !== adminHospitalId.toString()
      ) {
        return sendStatus(
          res,
          403,
          "Not authorized to manage leaves for this hospital",
        );
      }

      // HR cannot approve/reject their own leave
      if (role === "hr" && leave.requester.toString() === _id.toString()) {
        return sendStatus(
          res,
          403,
          "HR cannot approve or reject their own leave requests. This must be done by a Hospital Admin.",
        );
      }
    } else if (role !== "super-admin") {
      return sendStatus(
        res,
        403,
        "Only hospital admins, HR, and super admins can manage leaves",
      );
    }

    leave.status = status;
    await leave.save();

    // Notify User
    await createNotification(req, {
      hospital: leave.hospital,
      recipient: leave.requester,
      sender: _id,
      type: "leave_status",
      message: `Your leave request for ${new Date(leave.startDate).toLocaleDateString()} has been ${status}`,
      relatedId: leave._id,
    });

    if ((req as any).io) {
      const requesterIdStr = leave.requester.toString();
      const hospitalIdStr = leave.hospital.toString();
      const adminRoom = `hospital_${hospitalIdStr}_hospital-admin`;
      const hrRoom = `hospital_${hospitalIdStr}_hr`;

      console.log(
        `📡 Emitting leave:status_change to rooms: user_${requesterIdStr}, ${adminRoom}, ${hrRoom}`,
      );
      
      (req as any).io.to(`user_${requesterIdStr}`).to(adminRoom).to(hrRoom).emit("leave:status_change", {
        message: `Leave request ${status}`,
        leave,
      });
    }

    // Leave Integration: If approved, mark attendance as 'on-leave' for the period
    if (status === "approved") {
      const start = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      const hospitalId = leave.hospital;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const date = new Date(d);
        date.setHours(0, 0, 0, 0);

        await Attendance.findOneAndUpdate(
          { user: leave.requester, date },
          {
            user: leave.requester,
            hospital: hospitalId,
            date,
            status: "on-leave",
          },
          { upsert: true },
        );
      }
    }

    res.json({ message: `Leave ${status}`, leave });
  } catch (error) {
    console.error("Update Leave Status Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
// Get Leave Balance
export const getLeaveBalance = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const role = (req as any).user.role;

    // 1. Get Quotas from StaffProfile (or defaults)
    const StaffProfile = (await import("../../Staff/Models/StaffProfile.js"))
      .default;
    const staffProfile = await StaffProfile.findOne({ user: userId });

    const MONTHLY_SICK_QUOTA = staffProfile?.sickLeaveQuota ?? 1;
    const MONTHLY_EMERGENCY_QUOTA = staffProfile?.emergencyLeaveQuota ?? 1;
    const MONTHLY_CASUAL_QUOTA = 0; // Defaulting to 0 as per user request (only sick and emergency mentioned)

    // 2. Define Current Month Range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    // 3. Count approved leaves for the current month
    const approvedLeaves = await Leave.find({
      requester: userId,
      status: "approved",
      $or: [
        { startDate: { $gte: startOfMonth, $lte: endOfMonth } },
        { endDate: { $gte: startOfMonth, $lte: endOfMonth } },
      ],
    });

    let usedSick = 0;
    let usedEmergency = 0;
    let usedOther = 0;

    approvedLeaves.forEach((leave) => {
      const start = new Date(
        Math.max(new Date(leave.startDate).getTime(), startOfMonth.getTime()),
      );
      const end = new Date(
        Math.min(new Date(leave.endDate).getTime(), endOfMonth.getTime()),
      );
      const days =
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
        1;

      if (leave.leaveType === "sick") usedSick += days;
      else if (leave.leaveType === "emergency") usedEmergency += days;
      else usedOther += days;
    });

    res.status(200).json({
      balance: {
        sick: Math.max(0, MONTHLY_SICK_QUOTA - usedSick),
        totalSick: MONTHLY_SICK_QUOTA,
        emergency: Math.max(0, MONTHLY_EMERGENCY_QUOTA - usedEmergency),
        totalEmergency: MONTHLY_EMERGENCY_QUOTA,
        casual: 0,
        totalCasual: 0,
        other: usedOther,
        month: now.toLocaleString("default", { month: "long" }),
      },
    });
  } catch (error: any) {
    console.error("Get Leave Balance Error:", error);
    res.status(500).json({ message: error.message });
  }
};
// Get Leave By ID
export const getLeaveById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const leave = await Leave.findById(id).populate(
      "requester",
      "name email role",
    );

    if (!leave)
      return res.status(404).json({ message: "Leave request not found" });

    res.status(200).json({ leave });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// Delete Leave Request
export const deleteLeave = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user._id;
    const role = (req as any).user.role;

    const leave = await Leave.findById(id);
    if (!leave)
      return res.status(404).json({ message: "Leave request not found" });

    // Authorization: Only the requester can delete, and only if it's pending
    if (
      leave.requester.toString() !== userId.toString() &&
      role !== "super-admin"
    ) {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this leave request" });
    }

    if (leave.status !== "pending" && role !== "super-admin") {
      return res.status(400).json({
        message:
          "Cannot delete a leave request that is already approved or rejected",
      });
    }

    await Leave.findByIdAndDelete(id);
    res.status(200).json({ message: "Leave request deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
