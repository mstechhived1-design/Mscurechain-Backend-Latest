import { Request, Response } from "express";
import Notification from "../Models/Notification.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import { NotificationRequest } from "../types/index.js";
import { IUser } from "../../Auth/types/index.js";

import Patient from "../../Patient/Models/Patient.js";

interface CreateNotificationParams {
  hospital?: any;
  recipient: any; // User ID
  recipientModel?: "User" | "Patient"; // Default 'User'
  sender?: any; // User ID
  senderModel?: "User" | "Patient";
  type: string;
  message: string;
  relatedId?: any;
}

import User from "../../Auth/Models/User.js";
import { io as globalIo } from "../../config/socket.js";

// Helper to create notification (Internal Use)
export const createNotification = async (
  req: Request | null,
  {
    hospital,
    recipient,
    recipientModel,
    sender,
    senderModel,
    type,
    message,
    relatedId,
  }: CreateNotificationParams,
) => {
  try {
    const notification: any = await Notification.create({
      hospital: hospital || (req as any)?.user?.hospital,
      recipient,
      recipientModel: recipientModel || "User",
      sender,
      senderModel: senderModel || "User",
      type,
      message,
      relatedId,
    });

    // Get IO instance efficiently
    const io = (req as any)?.io || globalIo;

    // Emit Socket Event
    if (io) {
      // Bulk lookup is usually better, but for single notif we use lean findById
      // Try to find recipient in either collection to get their role for the socket room
      let user = await (User.findById(recipient) as any).unscoped().select("role").lean();
      if (!user) {
        user = (await (Patient.findById(recipient) as any).unscoped().select("role").lean()) as any;
      }

      if (user) {
        const userRoom = `${(user as any).role}_${recipient.toString()}`;

        io.to(userRoom).emit("notification:new", {
          _id: notification._id.toString(),
          type,
          message,
          relatedId: relatedId ? relatedId.toString() : undefined,
          sender: sender ? sender.toString() : undefined,
          createdAt: notification.createdAt,
          isRead: false,
        });
      }
    }

    return notification;
  } catch (err) {
    console.error("Notification creation error:", err);
  }
};

export const getNotifications = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const notifReq = req as unknown as NotificationRequest;
  try {
    const user = notifReq.user as IUser;
    const { hospitalId } = req.query;

    const query: any = { recipient: user._id };
    
    // If hospitalId is provided and user is masterhelpdesk or admin, filter by it
    if (hospitalId && ["masterhelpdesk", "super-admin", "hospital-admin"].includes(user.role)) {
      query.hospital = hospitalId;
    }

    const notifications = await Notification.find(query).sort(
      { createdAt: -1 },
    );
    res.json(notifications);
  } catch (err) {
    console.error("getNotifications error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const markAsRead = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const notifReq = req as unknown as NotificationRequest;
  try {
    const user = notifReq.user as IUser;
    // ✅ FIX: Verify the notification belongs to this user (ownership check)
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: user._id },
      { isRead: true, readAt: new Date() },
      { new: true },
    );
    if (!notification) {
      res.status(404).json({ message: "Notification not found" });
      return;
    }
    res.json(notification);
  } catch (err) {
    console.error("markAsRead error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const markAllAsRead = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const notifReq = req as unknown as NotificationRequest;
  try {
    const user = notifReq.user as IUser;
    await Notification.updateMany(
      { recipient: user._id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
    );
    res.json({ message: "All marked as read" });
  } catch (err) {
    console.error("markAllAsRead error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteAllNotifications = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const notifReq = req as unknown as NotificationRequest;
  try {
    const user = notifReq.user as IUser;
    await Notification.deleteMany({ recipient: user._id });
    res.json({ message: "All notifications deleted" });
  } catch (err) {
    console.error("deleteAllNotifications error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Restore deleteNotification
export const deleteNotification = async (
  req: Request,
  res: Response,
): Promise<any> => {
  const notifReq = req as unknown as NotificationRequest;
  try {
    const user = notifReq.user as IUser;
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: user._id, // Ensure user owns the notification
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({ message: "Notification deleted" });
  } catch (err) {
    console.error("deleteNotification error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteEmergencyAlerts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const notifReq = req as unknown as NotificationRequest;
  try {
    const user = notifReq.user as IUser;
    // Delete all notifications of type 'emergency_alert' for this user
    await Notification.deleteMany({
      recipient: user._id,
      type: "emergency_alert",
    });
    res.json({ message: "Emergency alerts cleared" });
  } catch (err) {
    console.error("deleteEmergencyAlerts error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Broadcast Emergency Alert (Helpdesk -> Doctors of Hospital)
export const sendEmergencyAlert = async (
  req: Request,
  res: Response,
): Promise<any> => {
  const notifReq = req as unknown as NotificationRequest;
  try {
    const { hospitalId, message } = req.body;
    const senderId = (notifReq.user as IUser)._id;

    if (!hospitalId || !message) {
      return res
        .status(400)
        .json({ message: "Hospital ID and message are required" });
    }

    // Find all doctors working in this hospital
    // We need to find DoctorProfiles where 'hospital' matches hospitalId

    const doctors: any = await DoctorProfile.find({
      hospital: hospitalId,
    }).populate("user");

    const notifications: any[] = [];

    for (const doc of doctors) {
      if (!doc.user) continue;

      const notif: any = await createNotification(req, {
        hospital: hospitalId,
        recipient: doc.user._id,
        sender: senderId,
        type: "emergency_alert",
        message: message,
        relatedId: hospitalId,
      });
      notifications.push(notif);

      // Emit Socket
      if ((req as any).io) {
        (req as any).io.to(`doctor_${doc.user._id}`).emit("notification:new", {
          _id: notif._id,
          message: `EMERGENCY: ${message}`,
          type: "emergency_alert",
          senderName: (notifReq.user as IUser).name,
          createdAt: notif.createdAt,
        });
      }
    }

    res.json({
      message: `Emergency alert sent to ${notifications.length} doctors`,
      count: notifications.length,
    });
  } catch (err) {
    console.error("sendEmergencyAlert error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
