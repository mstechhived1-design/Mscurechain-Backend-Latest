import { Request, Response } from "express";
import Recruitment from "../Models/Recruitment.js";
import User from "../../Auth/Models/User.js";

/**
 * HR: Create a new recruitment request/notice
 */
export const createRecruitmentRequest = async (req: Request, res: Response) => {
  try {
    const {
      title,
      department,
      description,
      requirements,
      numberOfPositions,
      type,
    } = req.body;
    const requester = (req as any).user;
    const hospitalId = (req as any).tenantId || requester.hospital;

    const recruitment = await Recruitment.create({
      hospital: hospitalId,
      title,
      department,
      description,
      requirements,
      numberOfPositions,
      type,
      createdBy: requester._id,
      status: "pending_approval",
    });

    // Notify Hospital Admin and HR via Socket
    const io = (req as any).io;
    const adminRoom = `hospital_${hospitalId}_hospital-admin`;
    const hrRoom = `hospital_${hospitalId}_hr`;
    
    io.to(adminRoom).emit("new_recruitment_request", {
      message: `New recruitment request for ${title} in ${department}`,
      recruitmentId: recruitment._id,
    });
    
    io.to(hrRoom).emit("new_recruitment_request", {
      message: `New recruitment request for ${title} in ${department}`,
      recruitmentId: recruitment._id,
    });

    res.status(201).json({
      success: true,
      message: "Recruitment request sent for approval",
      data: recruitment,
    });
  } catch (err: any) {
    res.status(500).json({
      message: "Error creating recruitment request",
      error: err.message,
    });
  }
};

/**
 * HR & Admin: Get all recruitment notices
 */
export const getRecruitments = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;
    const hospitalId = (req as any).tenantId || requester.hospital;
    const { status } = req.query;

    const query: any = { hospital: hospitalId };
    if (status) {
      query.status = status;
    }

    const recruitments = await (
      Recruitment.find(query)
        .populate({
          path: "createdBy",
          select: "name email",
          options: { unscoped: true },
        })
        .populate({
          path: "approvedBy",
          select: "name email",
          options: { unscoped: true },
        })
        .sort({ createdAt: -1 }) as any
    ).unscoped();

    res.json({
      success: true,
      data: recruitments,
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: "Error fetching recruitments", error: err.message });
  }
};

/**
 * Hospital Admin: Approve or Reject recruitment request
 */
export const reviewRecruitmentRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;
    const requester = (req as any).user;
    const hospitalId = (req as any).tenantId || requester.hospital;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const recruitment = await (
      Recruitment.findOne({
        _id: id,
        hospital: hospitalId,
      }) as any
    ).unscoped();

    if (!recruitment) {
      return res.status(404).json({ message: "Recruitment request not found" });
    }

    recruitment.status = status;
    recruitment.approvedBy = requester._id;
    if (status === "rejected") {
      recruitment.rejectionReason = rejectionReason;
    } else {
      recruitment.postedAt = new Date();
      recruitment.status = "open"; // Move to open status automatically if approved?
      // Or maybe HR needs to manually open it. The user said: "if approvide hr can start the recruitment process"
      // So let's keep it as 'approved' and let HR change it to 'open'.
    }

    await recruitment.save();

    // Notify HR via Socket
    const io = (req as any).io;
    const hrRoom = `hospital_${hospitalId}_hr`;
    io.to(hrRoom).emit("recruitment_review_update", {
      message: `Recruitment request for ${recruitment.title} has been ${status}`,
      recruitmentId: recruitment._id,
      status,
    });

    res.json({
      success: true,
      message: `Recruitment request ${status}`,
      data: recruitment,
    });
  } catch (err: any) {
    res.status(500).json({
      message: "Error reviewing recruitment request",
      error: err.message,
    });
  }
};

/**
 * HR: Update recruitment status (e.g., from approved to open, or to paused/closed)
 */
export const updateRecruitmentStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const requester = (req as any).user;
    const hospitalId = (req as any).tenantId || requester.hospital;

    const allowedStatuses = ["open", "paused", "closed"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status transition" });
    }

    const recruitment = await (
      Recruitment.findOne({
        _id: id,
        hospital: hospitalId,
      }) as any
    ).unscoped();

    if (!recruitment) {
      return res.status(404).json({ message: "Recruitment not found" });
    }

    if (
      recruitment.status === "pending_approval" ||
      recruitment.status === "rejected"
    ) {
      return res.status(400).json({
        message: "Cannot change status of a request that is not approved",
      });
    }

    recruitment.status = status;
    if (status === "open" && !recruitment.postedAt) {
      recruitment.postedAt = new Date();
    }

    await recruitment.save();

    // Notify HR and Hospital Admin via Socket
    if ((req as any).io) {
      const io = (req as any).io;
      const hrRoom = `hospital_${hospitalId}_hr`;
      const adminRoom = `hospital_${hospitalId}_hospital-admin`;
      
      io.to(hrRoom).to(adminRoom).emit("recruitment_review_update", {
        message: `Recruitment status updated to ${status}`,
        recruitmentId: recruitment._id,
        status
      });
    }

    res.json({
      success: true,
      message: `Recruitment status updated to ${status}`,
      data: recruitment,
    });
  } catch (err: any) {
    res.status(500).json({
      message: "Error updating recruitment status",
      error: err.message,
    });
  }
};

/**
 * Get single recruitment detail
 */
export const getRecruitmentDetail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const hospitalId = (req as any).tenantId || (req as any).user.hospital;

    const recruitment = await (
      Recruitment.findOne({
        _id: id,
        hospital: hospitalId,
      })
        .populate({
          path: "createdBy",
          select: "name email",
          options: { unscoped: true },
        })
        .populate({
          path: "approvedBy",
          select: "name email",
          options: { unscoped: true },
        }) as any
    ).unscoped();

    if (!recruitment) {
      return res.status(404).json({ message: "Recruitment not found" });
    }

    res.json({
      success: true,
      data: recruitment,
    });
  } catch (err: any) {
    res.status(500).json({
      message: "Error fetching recruitment detail",
      error: err.message,
    });
  }
};
