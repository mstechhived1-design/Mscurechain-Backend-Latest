import { Response } from "express";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";

// Upload Document (Profile/Certificates) for Pharmacists
export const uploadDocument = async (req: any, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res
        .status(400)
        .json({
          message: "Invalid file type. Only PDF and Images are allowed.",
        });
    }

    const isPdf = req.file.mimetype === "application/pdf";
    const publicId = `pharmacy_docs/${req.user._id}_${Date.now()}`;

    const result = await uploadToCloudinary(req.file.buffer, {
      public_id: publicId,
      resource_type: isPdf ? "raw" : "image",
      type: "upload",
    });

    res.json({
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "File upload failed" });
  }
};
