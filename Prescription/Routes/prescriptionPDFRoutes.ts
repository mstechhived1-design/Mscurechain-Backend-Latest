import express, { Request, Response } from "express";
import upload from "../../middleware/Upload/upload.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import cloudinary from "../../config/cloudinary.js";

const router = express.Router();

/**
 * POST /api/prescriptions/upload-pdf
 * Upload prescription PDF to Cloudinary
 * Requires authentication
 */
router.post("/upload-pdf", protect, upload.single("prescription"), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded. Please attach a PDF file."
            });
        }

        // File was successfully uploaded via multer-storage-cloudinary
        const uploadedFile = {
            url: (req.file as any).path,
            public_id: (req.file as any).filename,
            format: (req.file as any).format,
            size: req.file.size,
            originalName: req.file.originalname
        };

        res.status(200).json({
            success: true,
            message: "Prescription PDF uploaded successfully",
            file: uploadedFile
        });
    } catch (error: any) {
        console.error("PDF Upload Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to upload prescription PDF",
            error: error.message
        });
    }
});

/**
 * POST /api/prescriptions/upload-pdf-buffer
 * Upload prescription PDF from buffer/base64 (for frontend-generated PDFs)
 * Requires authentication
 */
router.post("/upload-pdf-buffer", protect, async (req: Request, res: Response) => {
    try {
        const { pdfBuffer, fileName, patientId, appointmentId } = req.body;

        if (!pdfBuffer) {
            return res.status(400).json({
                success: false,
                message: "No PDF data provided"
            });
        }

        // Upload buffer directly to Cloudinary
        const uploadResult: any = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: 'hospital_management_reports',
                    type: 'upload', // Make public
                    resource_type: 'raw',
                    // format: 'pdf', // Removed to prevent double extension or unwanted behavior
                    public_id: `prescription_${patientId || 'unknown'}_${Date.now()}`,
                    tags: ['prescription', patientId, appointmentId].filter(Boolean)
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );

            // Write buffer to stream
            const buffer = Buffer.from(pdfBuffer, 'base64');
            uploadStream.end(buffer);
        });

        res.status(200).json({
            success: true,
            message: "Prescription PDF uploaded successfully",
            file: {
                url: uploadResult.secure_url,
                public_id: uploadResult.public_id,
                format: uploadResult.format,
                size: uploadResult.bytes
            }
        });
    } catch (error: any) {
        console.error("PDF Buffer Upload Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to upload prescription PDF from buffer",
            error: error.message
        });
    }
});

/**
 * DELETE /api/prescriptions/delete-pdf/:public_id
 * Delete prescription PDF from Cloudinary
 * Requires authentication
 */
router.delete("/delete-pdf/:public_id", protect, async (req: Request, res: Response) => {
    try {
        const { public_id } = req.params;

        if (!public_id) {
            return res.status(400).json({
                success: false,
                message: "Public ID is required"
            });
        }

        // Delete from Cloudinary
        const result = await cloudinary.uploader.destroy(public_id, {
            resource_type: 'raw'
        });

        if (result.result === 'ok' || result.result === 'not found') {
            res.status(200).json({
                success: true,
                message: "Prescription PDF deleted successfully",
                result: result.result
            });
        } else {
            res.status(400).json({
                success: false,
                message: "Failed to delete prescription PDF",
                result: result.result
            });
        }
    } catch (error: any) {
        console.error("PDF Delete Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to delete prescription PDF",
            error: error.message
        });
    }
});

export default router;
