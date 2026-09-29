import { Request, Response } from "express";
import Announcement from "../Models/Announcement.js";
import User from "../../Auth/Models/User.js";
import { createNotification } from "./notificationController.js";

export const createAnnouncement = async (req: Request, res: Response) => {
  try {
    const { title, content, priority, targetRoles, hospitalId, expiryDate } =
      req.body;
    const author = (req as any).user._id;
    const hospital = hospitalId || (req as any).user.hospital;

    const announcement = await Announcement.create({
      title,
      content,
      priority,
      targetRoles,
      author,
      hospital,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
    });

    // ✅ NOTIFICATION INTEGRATION: Notify targeted users
    // If targetRoles is empty or contains 'all', notify all active users in the hospital
    const rolesFilter =
      !targetRoles ||
      targetRoles.length === 0 ||
      targetRoles.includes("all") ||
      targetRoles.includes("All")
        ? {}
        : { role: { $in: targetRoles } };

    const usersToNotify = await (
      User.find({
        hospital: hospital,
        status: "active",
        ...rolesFilter,
      }) as any
    ).unscoped();

    console.log(
      `[ANNOUNCEMENT] Sending notifications to ${usersToNotify.length} users for announcement: ${title}`,
    );

    // Create notifications for all target users
    // Using for-of to allow await if we want to ensure they're created,
    // though for large numbers, a background queue would be better.
    // For now, we'll fire them off.
    usersToNotify.forEach((user: any) => {
      createNotification(req, {
        hospital,
        recipient: user._id,
        sender: author,
        type: "hospital_announcement",
        message: `Announcement: ${title}`,
        relatedId: announcement._id,
      }).catch((err) =>
        console.error(`Failed to notify user ${user._id}:`, err),
      );
    });

    res.status(201).json({
      success: true,
      message: `Announcement created and ${usersToNotify.length} users notified.`,
      announcement,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getHospitalAnnouncements = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).tenantId || (req as any).user.hospital;
    const now = new Date();
    const announcements = await (
      Announcement.find({
        $and: [
          { $or: [{ hospital: hospitalId }, { hospital: null }] },
          // Filter out expired announcements: full datetime precision (to-the-second)
          // Only show announcements with no expiryDate OR expiryDate strictly in the future
          { $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }] },
        ],
      }) as any
    )
      .unscoped()
      .sort({ createdAt: -1 })
      .populate({
        path: "author",
        select: "name role",
        options: { unscoped: true },
      });

    res.json({ announcements });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getAllAnnouncements = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const isSuperAdmin = user?.role === "super-admin";
    const now = new Date();

    // Filter out expired announcements for all roles
    const expiryFilter = {
      $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
    };

    // SuperAdmin sees all hospitals; others see only their hospital's + global ones
    const filter = isSuperAdmin
      ? expiryFilter
      : {
          $and: [
            { $or: [{ hospital: user.hospital }, { hospital: null }] },
            expiryFilter,
          ],
        };

    const announcements = await (Announcement.find(filter) as any)
      .unscoped()
      .sort({ createdAt: -1 })
      .populate({
        path: "author",
        select: "name role",
        options: { unscoped: true },
      })
      .populate("hospital", "name");

    res.json({ announcements });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateAnnouncement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const announcement = await (
      Announcement.findByIdAndUpdate(id, req.body, {
        new: true,
      }) as any
    ).unscoped();
    if (!announcement)
      return res.status(404).json({ message: "Announcement not found" });
    res.json({ announcement });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteAnnouncement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await (Announcement.findByIdAndDelete(id) as any).unscoped();
    res.json({ message: "Announcement deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
