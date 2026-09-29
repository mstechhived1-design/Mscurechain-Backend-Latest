import { Request, Response } from "express";
import DisplayDevice from "../Models/DisplayDevice.js";
import { getIO } from "../../config/socket.js";
import { AuthRequest } from "../../Auth/types/index.js";
import mongoose from "mongoose";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";

// Helper to safely get hospital ID from request
const getHospitalId = (req: any): mongoose.Types.ObjectId | undefined => {
  const user = req.user;
  if (user?.hospital) return user.hospital as mongoose.Types.ObjectId;
  if (req.hospital) return req.hospital._id as mongoose.Types.ObjectId;
  if (req.body?.hospitalId) return new mongoose.Types.ObjectId(req.body.hospitalId);
  return undefined;
};

export const pairDevice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pair_code, display_name, assigned_doctors, announcement_language, video_url, play_sound } = req.body;
    const hospitalId = getHospitalId(req);

    if (!hospitalId) {
      res.status(400).json({ success: false, message: "Hospital ID is required" });
      return;
    }

    if (!pair_code || !display_name || !assigned_doctors) {
      res.status(400).json({ success: false, message: "Missing required fields" });
      return;
    }

    // Find the device by pair code (it might be pre-registered by the socket handler with just the code)
    let device = await DisplayDevice.findOne({ pair_code });

    if (device) {
      if (device.hospital && device.hospital.toString() !== hospitalId.toString()) {
        res.status(403).json({ success: false, message: "This pair code is invalid or already in use" });
        return;
      }
      device.display_name = display_name;
      device.assigned_doctors = assigned_doctors;
      if (announcement_language) device.announcement_language = announcement_language;
      if (video_url !== undefined) device.video_url = video_url;
      if (play_sound !== undefined) device.play_sound = play_sound;
      device.hospital = hospitalId;
      await device.save();
    } else {
      // If the TV hasn't connected to the socket yet but admin is pairing via code
      device = new DisplayDevice({
        display_id: new mongoose.Types.ObjectId().toHexString(),
        pair_code,
        display_name,
        assigned_doctors,
        announcement_language: announcement_language || "en-IN",
        video_url: video_url || "",
        play_sound: play_sound || false,
        hospital: hospitalId,
        status: "offline"
      });
      await device.save();
    }

    // Emit success event to the TV using its socket room (room name = pair_code initially)
    const io = getIO();
    if (io) {
      io.of("/tv-display").to(`tv_${pair_code}`).emit("paired_success", {
        display_id: device.display_id,
        display_name: device.display_name,
        assigned_doctors: device.assigned_doctors,
        announcement_language: device.announcement_language,
        video_url: device.video_url,
        play_sound: device.play_sound,
        hospital: device.hospital
      });
    }

    res.status(200).json({ success: true, message: "Device paired successfully", data: device });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDisplays = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    if (!hospitalId) {
      res.status(400).json({ success: false, message: "Hospital ID is required" });
      return;
    }

    const displays = await DisplayDevice.find({ hospital: hospitalId })
      .populate("assigned_doctors", "name specialization")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: displays });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateDisplay = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { display_name, assigned_doctors, announcement_language, video_url, play_sound } = req.body;
    const hospitalId = getHospitalId(req);

    const device = await DisplayDevice.findOne({ _id: id, hospital: hospitalId });
    if (!device) {
      res.status(404).json({ success: false, message: "Display not found" });
      return;
    }

    if (display_name) device.display_name = display_name;
    if (assigned_doctors) device.assigned_doctors = assigned_doctors;
    if (announcement_language) device.announcement_language = announcement_language;
    if (video_url !== undefined) device.video_url = video_url;
    if (play_sound !== undefined) device.play_sound = play_sound;

    await device.save();

    // Emit update event to the TV
    const io = getIO();
    if (io) {
      io.of("/tv-display").to(`tv_paired_${device.display_id}`).emit("display_updated", {
        display_name: device.display_name,
        assigned_doctors: device.assigned_doctors,
        announcement_language: device.announcement_language,
        video_url: device.video_url,
        play_sound: device.play_sound,
      });
    }

    res.status(200).json({ success: true, message: "Display updated successfully", data: device });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteDisplay = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const hospitalId = getHospitalId(req);

    const device = await DisplayDevice.findOneAndDelete({ _id: id, hospital: hospitalId });
    if (!device) {
      res.status(404).json({ success: false, message: "Display not found" });
      return;
    }

    // Emit disconnect to the TV
    const io = getIO();
    if (io) {
      io.of("/tv-display").to(`tv_paired_${device.display_id}`).emit("display_deleted");
    }

    res.status(200).json({ success: true, message: "Display deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const uploadVideo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "No video file uploaded" });
      return;
    }
    
    // Cloudinary automatically handles MP4/video files if resource_type is auto
    const result = await uploadToCloudinary(req.file.buffer, { folder: "tv-displays/videos" });
    
    res.status(200).json({ success: true, url: result.secure_url });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
