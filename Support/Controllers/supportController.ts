import { Response } from "express";
import SupportRequest from "../Models/SupportRequest.js";
import sendEmail from "../../utils/sendEmail.js";
import { SupportRequestRequest, IReply } from "../types/index.js";
import { IUser } from "../../Auth/types/index.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import StaffProfile from "../../Staff/Models/StaffProfile.js";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";
import externalSupportService from "../Services/externalSupportService.js";
import TicketSyncQueue from "../Models/TicketSyncQueue.js";

// @desc    Create a new support request
// @route   POST /api/support
// @access  Private (All authenticated users)
export const createSupportRequest = async (
  req: SupportRequestRequest,
  res: Response,
): Promise<any> => {
  try {
    const { subject, message, type, category } = req.body; // Accept category as alias for type
    const user = req.user as IUser;

    // Handle file uploads
    let attachments: string[] = [];
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      const files = req.files as Express.Multer.File[];
      const uploadPromises = files.map(async (file) => {
        try {
          const res = await uploadToCloudinary(file.buffer);
          return res.secure_url;
        } catch (err: any) {
          console.error(
            `Failed to upload file ${file.originalname}:`,
            err.message || err,
          );
          return null;
        }
      });

      const results = await Promise.all(uploadPromises);
      attachments = results.filter((url): url is string => url !== null);
    }

    let ticketType = (type || category || "feedback").toLowerCase().trim();
    if (ticketType === "bug report") ticketType = "bug";

    const newRequest = new SupportRequest({
      hospital: (req as any).hospitalId || user.hospital,
      userId: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      subject,
      message,
      type: ticketType,
      attachments,
    });

    await newRequest.save();

    // ==========================================
    // 🔗 INTEGRATION: Sync with External Support System
    // ==========================================

    // Prepare payload for external system
    const syncPayload = {
      ticketId: newRequest._id.toString(),
      userId: user._id.toString(),
      name: user.name,
      email: user.email || "no-email@mscurechain.com",
      role: user.role,
      subject,
      message,
      type: ticketType,
      status: newRequest.status,
      attachments,
      createdAt: newRequest.createdAt,
    };

    // Attempt to sync with external Support System (non-blocking)
    try {
      const syncResult = await externalSupportService.syncTicket(syncPayload);

      if (!syncResult.success) {
        // Sync failed - Queue for retry
        console.warn(
          `[Support] Failed to sync ticket ${newRequest._id} immediately. Queueing for retry...`,
        );
        await TicketSyncQueue.create({
          hospital: newRequest.hospital,
          ticketId: newRequest._id,
          payload: syncPayload,
          retryCount: 0,
          status: "pending",
          error: syncResult.message,
        });
      } else {
        console.log(
          `[Support] ✅ Ticket ${newRequest._id} synced successfully to external Support Dashboard`,
        );
      }
    } catch (syncError: any) {
      // Critical error during sync attempt - still queue for retry
      console.error(
        `[Support] Error during external sync for ticket ${newRequest._id}:`,
        syncError.message,
      );
      await TicketSyncQueue.create({
        hospital: newRequest.hospital,
        ticketId: newRequest._id,
        payload: syncPayload,
        retryCount: 0,
        status: "pending",
        error: syncError.message,
      });
    }

    // ==========================================
    // End of Integration Logic
    // ==========================================

    // Send Email Logic
    const EMAIL_USER_FINAL = process.env.EMAIL_USER_FINAL;
    if (!EMAIL_USER_FINAL) {
      throw new Error("EMAIL_USER_FINAL not configured");
    }
    const emailSubject = `[Support - ${newRequest.type.toUpperCase()}] ${subject}`;

    const attachmentHtml = attachments
      .map(
        (url) =>
          `<div style="margin: 10px 0;"><img src="${url}" alt="Attachment" style="max-width: 100%; border-radius: 8px; border: 1px solid #ddd;" /></div>`,
      )
      .join("");

    const emailBody = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 20px; border-radius: 12px;">
                <div style="background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                    <div style="border-bottom: 2px solid #f3f4f6; padding-bottom: 20px; margin-bottom: 20px;">
                        <h2 style="color: #111827; margin: 0; font-size: 24px;">New Support Request</h2>
                        <span style="display: inline-block; background-color: #dbeafe; color: #1e40af; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: bold; margin-top: 10px; text-transform: uppercase;">
                            ${newRequest.type}
                        </span>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <p style="margin: 5px 0; color: #4b5563; font-size: 14px;"><strong>From:</strong> ${user.name} <span style="color: #9ca3af;">(${user.role})</span></p>
                        <p style="margin: 5px 0; color: #4b5563; font-size: 14px;"><strong>Email:</strong> <a href="mailto:${user.email}" style="color: #2563eb; text-decoration: none;">${user.email}</a></p>
                    </div>

                    <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h4 style="margin: 0 0 10px 0; color: #374151; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;">Message</h4>
                        <p style="color: #1f2937; line-height: 1.6; white-space: pre-wrap; margin: 0;">${message}</p>
                    </div>

                    ${attachments.length > 0
        ? `
                        <div style="margin-top: 20px;">
                            <h4 style="margin: 0 0 10px 0; color: #374151; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;">Attachments</h4>
                            ${attachmentHtml}
                        </div>
                    `
        : ""
      }

                    <div style="margin-top: 30px; pt-20px; border-top: 1px solid #f3f4f6; text-align: center;">
                        <p style="color: #9ca3af; font-size: 12px; margin: 0;">This is an automated message from the Hospital Management System Support.</p>
                    </div>
                </div>
            </div>
        `;

    const recipients: string[] = [EMAIL_USER_FINAL];
    const hospitalRoles = [
      "doctor",
      "staff",
      "nurse",
      "helpdesk",
      "masterhelpdesk",
      "ambulance",
      "lab",
      "pharma-owner",
      "admin",
      "DISCHARGE",
      "emergency",
    ];

    // If user belongs to a hospital, fetch their Hospital Admin email
    if (hospitalRoles.includes(user.role)) {
      try {
        let hospitalId = user.hospital;

        // Fallback for profiles that might not have hospital on User doc but on Profile
        if (!hospitalId) {
          if (user.role === "doctor") {
            const docProfile = await DoctorProfile.findOne({ user: user._id });
            hospitalId = docProfile?.hospital;
          } else if (["staff", "nurse"].includes(user.role)) {
            const staffProfile = await StaffProfile.findOne({ user: user._id });
            hospitalId = staffProfile?.hospital;
          } else if (user.role === "ambulance") {
            const ambulance = await (
              await import("../../Emergency/Models/AmbulancePersonnel.js")
            ).default.findOne({ _id: user._id });
            hospitalId = ambulance?.hospital;
          }
        }

        if (hospitalId) {
          const UserModel = (await import("../../Auth/Models/User.js")).default;
          const hospitalAdmins = await UserModel.find({
            role: "hospital-admin",
            hospital: hospitalId,
          });

          hospitalAdmins.forEach((admin) => {
            if (admin.email) recipients.push(admin.email);
          });
        }
      } catch (err) {
        console.error("Failed to fetch hospital admin emails", err);
      }
    }

    // Send emails
    await Promise.all(
      recipients.map((email) =>
        sendEmail(email, emailSubject, emailBody).catch((e) =>
          console.error(`Failed to send to ${email}`, e),
        ),
      ),
    );

    res.status(201).json({
      success: true,
      message: "Support request submitted successfully.",
      data: newRequest,
    });
  } catch (error: any) {
    console.error("Create Support Error:", error);
    try {
      require('fs').writeFileSync('debug_error.log', "Error Message: " + error.message + "\n\nStack:\n" + error.stack);
    } catch (e) { }
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const getAllSupportRequests = async (
  req: SupportRequestRequest,
  res: Response,
): Promise<void> => {
  try {
    const requestUser = req.user as IUser;
    const isSuperAdmin = ["super-admin", "admin"].includes(requestUser.role);

    // Super-admin sees ALL tickets globally; hospital-admin sees only their hospital's tickets
    const query: any = {};
    if (!isSuperAdmin && requestUser.hospital) {
      query.hospital = requestUser.hospital;
    }

    const requests = await SupportRequest.find(query)
      .populate("userId", "name role email")
      .populate("hospital", "name hospitalId address")
      .sort({ createdAt: -1 });

    res.status(200).json(requests);
  } catch (error) {
    console.error("Get Support Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const getSupportRequestById = async (
  req: SupportRequestRequest,
  res: Response,
): Promise<any> => {
  try {
    let ticket = await SupportRequest.findById(req.params.id)
      .populate("userId", "name role email")
      .populate("hospital", "name hospitalId")
      .populate("replies.senderId", "name role");

    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found" });
    }

    const requestUser = req.user as IUser;
    const userRole = requestUser.role as string; // Type assertion to handle all role types
    let ticketOwnerId: string | null = null;

    // Determine ownership safely
    if (ticket.userId && (ticket.userId as any)._id) {
      // Populated successfully
      ticketOwnerId = (ticket.userId as any)._id.toString();
    } else if (ticket.userId) {
      // Probably a string (if populate didn't happen - unlikely but possible) or partial
      ticketOwnerId = ticket.userId.toString();
    } else {
      // userId is Null after populate. This means the referenced User doc is missing or populate failed.
      // We need the raw userId to verify ownership for the current requester (if they ARE that missing user, which is a paradox, but maybe consistency lag?)
      // Or more likely: The user exists (requestUser) but populate failed due to mismatch.
      // Let's re-fetch just the raw ID to be sure.
      const rawTicket = await SupportRequest.findById(req.params.id).select(
        "userId",
      );
      if (rawTicket && rawTicket.userId) {
        ticketOwnerId = rawTicket.userId.toString();
      }
    }

    if (!ticketOwnerId) {
      // Truly orphan ticket
      const adminRoles = ["super-admin", "hospital-admin", "admin"];
      if (!adminRoles.includes(userRole)) {
        // Even orphans can't be seen by regular users if we can't verify 'Mine'
        return res.status(403).json({
          success: false,
          message: "Ticket owner unknown, access denied",
        });
      }
    } else if (
      ticketOwnerId !== requestUser._id.toString() &&
      !["hospital-admin", "super-admin", "admin"].includes(userRole)
    ) {
      // Owner mismatch and not an admin
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this ticket",
      });
    }

    res.status(200).json(ticket);
  } catch (error) {
    console.error("Get Ticket Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const addReply = async (
  req: SupportRequestRequest,
  res: Response,
): Promise<any> => {
  try {
    const { message } = req.body;
    const user = req.user as IUser;
    const ticketId = req.params.id;

    const ticket = await SupportRequest.findById(ticketId);
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found" });
    }

    let attachments: string[] = [];
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      const files = req.files as Express.Multer.File[];
      const uploadPromises = files.map(async (file) => {
        try {
          const res = await uploadToCloudinary(file.buffer);
          return res.secure_url;
        } catch (err: any) {
          console.error(
            `Failed to upload file in reply: ${err.message || err}`,
          );
          return null;
        }
      });

      const results = await Promise.all(uploadPromises);
      attachments = results.filter((url): url is string => url !== null);
    }

    const reply: IReply = {
      senderId: user._id,
      senderName: user.name,
      role: user.role,
      message,
      attachments,
      createdAt: new Date(),
    };
    ticket.replies.push(reply);

    if (
      ["hospital-admin", "super-admin"].includes(user.role) &&
      ticket.status === "open"
    ) {
      ticket.status = "in-progress";
    }

    await ticket.save();

    const updatedTicket = await SupportRequest.findById(ticketId).populate(
      "replies.senderId",
      "name role",
    );

    res.status(200).json({ success: true, data: updatedTicket });
  } catch (error) {
    console.error("Add Reply Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const getMySupportRequests = async (
  req: SupportRequestRequest,
  res: Response,
): Promise<void> => {
  try {
    const user = req.user as IUser;
    const requests = await SupportRequest.find({ userId: user._id })
      .populate("userId", "name role email")
      .sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch (error) {
    console.error("Get My Support Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const updateSupportStatus = async (
  req: SupportRequestRequest,
  res: Response,
): Promise<any> => {
  try {
    const { status } = req.body;
    const ticket = await SupportRequest.findById(req.params.id);

    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found" });
    }

    if (!["open", "in-progress", "resolved"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    ticket.status = status as "open" | "in-progress" | "resolved";
    await ticket.save();

    res
      .status(200)
      .json({ success: true, message: "Status updated", data: ticket });
  } catch (error) {
    console.error("Update Status Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};
