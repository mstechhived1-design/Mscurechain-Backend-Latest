import { Response } from "express";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";

// Upload Document (Certificates/Documents) for Staff/Nurses
export const uploadStaffDocument = async (req: any, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const MAX_SIZE = 20 * 1024 * 1024; // 20MB
        if (req.file.size > MAX_SIZE) {
            return res.status(400).json({ message: "File too large. Maximum size is 20MB." });
        }

        const isPdf = req.file.mimetype === "application/pdf";
        const resourceType = isPdf ? "raw" : "image";

        let folderName = "staff_docs";
        if (req.user.role === "doctor") folderName = "doctor_docs";
        else if (req.user.role === "nurse") folderName = "nurse_docs";
        else if (req.user.role === "hr") folderName = "hr_docs";

        const publicId = `${folderName}/${req.user._id}_${Date.now()}`;

        const result = await uploadToCloudinary(req.file.buffer, {
            public_id: publicId,
            resource_type: resourceType,
            access_mode: "public",
        });

        res.json({
            success: true,
            url: result.secure_url,
            publicId: result.public_id,
            resource_type: resourceType,
            format: result.format || (isPdf ? "pdf" : req.file.mimetype.split("/")[1]),
            name: req.file.originalname,
            size: req.file.size
        });
    } catch (error) {
        console.error("Staff document upload error:", error);
        res.status(500).json({ message: "File upload failed" });
    }
};