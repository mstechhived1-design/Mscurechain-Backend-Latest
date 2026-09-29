import { Request, Response } from "express";
import Feedback from "../Models/Feedback.js";
import PatientProfile from "../Models/PatientProfile.js";
import mongoose from "mongoose";

// Create Feedback
export const createFeedback = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user._id;
        const { doctorId, rating, category, comment, isAnonymous, hospitalIds } = req.body;

        // Find Patient Profile
        const patientProfile = await PatientProfile.findOne({ user: userId });
        if (!patientProfile) {
            return res.status(404).json({ message: "Patient profile not found" });
        }

        // Determine which hospitals this feedback is for
        // 1. Provided hospitalIds from frontend
        // 2. Default to patient's linked hospital
        let targetHospitals: mongoose.Types.ObjectId[] = [];
        if (Array.isArray(hospitalIds) && hospitalIds.length > 0) {
            targetHospitals = hospitalIds.map((id: string) => new mongoose.Types.ObjectId(id));
        } else if (patientProfile.hospital) {
            targetHospitals = [patientProfile.hospital];
        }

        if (targetHospitals.length === 0) {
            return res.status(400).json({ message: "At least one hospital must be selected" });
        }

        const feedback = new Feedback({
            patient: patientProfile._id,
            hospital: targetHospitals,
            doctor: doctorId || null,
            rating,
            category: Array.isArray(category) ? category : [category],
            comment,
            isAnonymous
        });

        await feedback.save();

        // Emit Real-time Event to selected Hospital Admins
        const io = (req as any).io;
        if (io) {
            targetHospitals.forEach((hId: any) => {
                const hIdStr = hId.toString();
                io.to(`hospital_${hIdStr}`).emit('new_feedback', {
                    _id: feedback._id,
                    rating: feedback.rating,
                    category: feedback.category,
                    comment: feedback.comment,
                    createdAt: feedback.createdAt,
                    patientName: isAnonymous ? "Anonymous" : (req as any).user.name
                });
                console.log(`📡 Emitted new_feedback to hospital_${hIdStr}`);
            });
        }

        res.status(201).json({ success: true, data: feedback });

    } catch (error) {
        console.error("Error creating feedback:", error);
        res.status(500).json({ message: "Server Error", error });
    }
};

// Get Feedbacks (For Hospital Admin)
export const getFeedbacks = async (req: Request, res: Response) => {
    try {
        const { hospitalId, page = 1, limit = 10 } = req.query;

        if (!hospitalId) {
            return res.status(400).json({ message: "Hospital ID required" });
        }

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const skip = (pageNum - 1) * limitNum;

        const total = await Feedback.countDocuments({ hospital: hospitalId });

        const feedbacks = await Feedback.find({ hospital: hospitalId })
            .populate('patient', 'mrn')
            .populate('doctor', 'firstName lastName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum);

        res.status(200).json({
            success: true,
            data: feedbacks,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error("Error fetching feedbacks:", error);
        res.status(500).json({ message: "Server Error", error });
    }
};

// Update Feedback Status
export const updateFeedbackStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['New', 'In Progress', 'Resolved', 'Closed'].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }

        const feedback = await Feedback.findByIdAndUpdate(
            id,
            { status },
            { new: true }
        );

        if (!feedback) {
            return res.status(404).json({ message: "Feedback not found" });
        }

        res.status(200).json({ success: true, data: feedback });
    } catch (error) {
        console.error("Error updating feedback status:", error);
        res.status(500).json({ message: "Server Error", error });
    }
};

// Delete Feedback
export const deleteFeedback = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const feedback = await Feedback.findByIdAndDelete(id);

        if (!feedback) {
            return res.status(404).json({ message: "Feedback not found" });
        }

        res.status(200).json({ success: true, message: "Feedback deleted successfully" });
    } catch (error) {
        console.error("Error deleting feedback:", error);
        res.status(500).json({ message: "Server Error", error });
    }
};
