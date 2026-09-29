import { Request, Response } from "express";
import LabSettings from "../Models/LabSettings.js";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";

export const getLabSettings = async (req: Request, res: Response) => {
  try {
    const hospital = (req as any).user?.hospital;
    const query = hospital ? { hospital } : {};

    let settings = await LabSettings.findOne(query);
    if (!settings) {
      // Create default settings (with or without hospital)
      settings = await LabSettings.create({
        ...(hospital ? { hospital } : {}),
        name: "Medi Lab Laboratory",
        tagline: "Advanced Diagnostic Laboratory",
        address: "123 Medical Plaza, Healthcare District",
        phone: "+91 98765 43210",
        email: "lab@mscurechain.com",
      });
    }
    res.status(200).json(settings);
  } catch (error: any) {
    console.error("[LabSettings] getLabSettings error:", error);
    res
      .status(500)
      .json({ message: error?.message || "Error fetching lab settings" });
  }
};

export const updateLabSettings = async (req: Request, res: Response) => {
  try {
    const hospital = (req as any).user?.hospital;
    const filter = hospital ? { hospital } : {};
    const updates = req.body;
    // Upsert scoped by hospital
    const settings = await LabSettings.findOneAndUpdate(filter, updates, {
      new: true,
      upsert: true,
    });
    res.status(200).json(settings);
  } catch (error: any) {
    console.error("[LabSettings] updateLabSettings error:", error);
    res
      .status(500)
      .json({ message: error?.message || "Error updating lab settings" });
  }
};

export const uploadLabLogo = async (req: Request, res: Response) => {
  try {
    console.log(
      "Upload request received. File:",
      req.file ? "Present" : "Missing",
    );
    if (!req.file) {
      return res.status(400).json({ message: "No logo file provided" });
    }

    const result = await uploadToCloudinary(req.file.buffer, {
      folder: "lab_logos",
    });

    res.status(200).json({ url: result.secure_url });
  } catch (error: any) {
    console.error("Logo Upload Error Full:", error);
    res.status(500).json({
      message: "Failed to upload logo",
      error: error.message || error,
    });
  }
};

export const uploadLabImage = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file provided" });
    }
    const result = await uploadToCloudinary(req.file.buffer, {
      folder: "lab_images",
    });
    res.status(200).json({ url: result.secure_url });
  } catch (error: any) {
    console.error("Image Upload Error:", error);
    res.status(500).json({
      message: "Failed to upload image",
      error: error.message || error,
    });
  }
};
