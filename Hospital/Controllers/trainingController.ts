import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import TrainingRecord from '../Models/TrainingRecord.js';
import asyncHandler from '../../middleware/Utils/asyncHandler.js';
import ApiError from '../../utils/ApiError.js';
import { uploadToCloudinary } from '../../utils/uploadToCloudinary.js';

export const createTraining = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    let { trainingName, trainingDate, department, participants, description, status, cancellationReason } = req.body;

    console.log(`[Training Create] Status: ${status}, Reason: ${cancellationReason}`);

    // Handle legacy 'reason' field if 'cancellationReason' is missing
    if (!cancellationReason && req.body.reason) {
        cancellationReason = req.body.reason;
    }

    // Parse and Sanitize participants
    if (typeof participants === 'string') {
        try {
            participants = JSON.parse(participants);
        } catch (e) {
            participants = participants.split(',').map((id: string) => id.trim());
        }
    }

    // Ensure participants is an array and filter out invalid ObjectIds
    if (!Array.isArray(participants)) {
        participants = [];
    }

    const sanitizedParticipants = participants.filter((id: any) => {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) console.warn(`[Training] Skipping invalid participant ID: ${id}`);
        return isValid;
    });

    const hospitalId = (req as any).user?.hospital;

    if (!hospitalId) {
        return next(new ApiError(400, 'Hospital ID not found for the logged in user'));
    }

    let certificateUrl = undefined;
    // upload.any() returns req.files as a flat array — pick the first file regardless of field name
    const filesArray = req.files as Express.Multer.File[] | undefined;
    const uploadedFile = req.file || (filesArray && filesArray[0]);
    if (uploadedFile) {
        try {
            const result = await uploadToCloudinary(uploadedFile.buffer, {
                folder: 'training_certificates',
                resource_type: 'auto'
            });
            certificateUrl = result.secure_url;
        } catch (error: any) {
            console.error("[Training] Cloudinary Upload Failed:", error);
            return next(new ApiError(500, `Certificate upload failed: ${error.message}`));
        }
    }

    try {
        const newTraining = await TrainingRecord.create({
            trainingName,
            trainingDate,
            department,
            participants: sanitizedParticipants,
            hospitalId,
            description,
            certificateUrl,
            status,
            cancellationReason
        });

        res.status(201).json({
            status: 'success',
            data: {
                training: newTraining,
            },
        });
    } catch (error: any) {
        console.error("[Training] Create Error:", error);
        if (error.name === 'ValidationError') {
            return next(new ApiError(400, `Validation Failed: ${error.message}`));
        }
        if (error.name === 'CastError') {
            return next(new ApiError(400, `Invalid Data Format: ${error.path}`));
        }
        next(error);
    }
});

export const getAllTrainings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const hospitalId = (req as any).user?.hospital;

    if (!hospitalId) {
        return next(new ApiError(400, 'Hospital ID not found'));
    }

    const trainings = await TrainingRecord.find({ hospitalId })
        .populate('participants', 'name email role department designation') // Populate limited fields
        .sort({ trainingDate: -1 });

    res.status(200).json({
        status: 'success',
        results: trainings.length,
        data: {
            trainings,
        },
    });
});

export const getStaffTrainings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const staffId = req.params.staffId || (req as any).user?._id;
    // Allow fetching either by param (admin viewing staff) or self (staff viewing self) 
    // Ideally, if usage is ambiguous, separate or clarify permissions. 
    // Here: if :staffId present, use it; else use logged in user's id.

    const trainings = await TrainingRecord.find({ participants: staffId })
        .sort({ trainingDate: -1 });

    res.status(200).json({
        status: 'success',
        results: trainings.length,
        data: {
            trainings,
        },
    });
});

export const updateTraining = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const trainingId = req.params.id;
    let { trainingName, trainingDate, department, participants, description, status, cancellationReason } = req.body;

    console.log(`[Training Update] ID: ${trainingId}, Status: ${status}, Reason: ${cancellationReason}`);
    console.log(`[Training Update] Body Fields:`, Object.keys(req.body));

    // Handle legacy 'reason' field if 'cancellationReason' is missing
    if (!cancellationReason && req.body.reason) {
        cancellationReason = req.body.reason;
    }
    if (typeof participants === 'string') {
        try {
            participants = JSON.parse(participants);
        } catch (e) {
            participants = participants.split(',').map((id: string) => id.trim());
        }
    }

    // Ensure participants is an array and filter out invalid ObjectIds
    if (!Array.isArray(participants)) {
        participants = [];
    }

    const sanitizedParticipants = participants.filter((id: any) => {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) console.warn(`[Training Update] Skipping invalid participant ID: ${id}`);
        return isValid;
    });

    let certificateUrl = req.body.certificateUrl; // Keep existing if not uploading new
    // upload.any() returns req.files as a flat array — pick the first file regardless of field name
    const updateFilesArray = req.files as Express.Multer.File[] | undefined;
    const updateUploadedFile = req.file || (updateFilesArray && updateFilesArray[0]);
    if (updateUploadedFile) {
        try {
            const result = await uploadToCloudinary(updateUploadedFile.buffer, {
                folder: 'training_certificates',
                resource_type: 'auto'
            });
            certificateUrl = result.secure_url;
        } catch (error: any) {
            console.error("[Training Update] Cloudinary Upload Failed:", error);
            return next(new ApiError(500, `Certificate update failed: ${error.message}`));
        }
    }

    try {
        const updatedTraining = await TrainingRecord.findByIdAndUpdate(
            trainingId,
            {
                trainingName,
                trainingDate,
                department,
                participants: sanitizedParticipants,
                description,
                certificateUrl,
                status,
                cancellationReason
            },
            { new: true, runValidators: true }
        );

        if (!updatedTraining) {
            return next(new ApiError(404, 'No training found with that ID'));
        }

        res.status(200).json({
            status: 'success',
            data: {
                training: updatedTraining
            }
        });
    } catch (error: any) {
        console.error("[Training Update] Error:", error);
        if (error.name === 'ValidationError') {
            return next(new ApiError(400, `Validation Failed: ${error.message}`));
        }
        if (error.name === 'CastError') {
            return next(new ApiError(400, `Invalid data format: ${error.path}`));
        }
        next(error);
    }
});

export const deleteTraining = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const trainingId = req.params.id;

    const training = await TrainingRecord.findByIdAndDelete(trainingId);

    if (!training) {
        return next(new ApiError(404, 'No training found with that ID'));
    }

    res.status(204).json({
        status: 'success',
        data: null
    });
});
