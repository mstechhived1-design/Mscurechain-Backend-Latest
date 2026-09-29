import { Request, Response } from "express";
import mongoose from "mongoose";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import IPDAdmission from "../Models/IPDAdmission.js";
import VitalsRecord from "../Models/VitalsRecord.js";
import MedicationRecord from "../Models/MedicationRecord.js";
import BedOccupancy from "../Models/BedOccupancy.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import DietLog from "../Models/DietLog.js";
import ApiError from "../../utils/ApiError.js";

/**
 * Get Combined Hourly Monitoring Data for a Patient
 * Includes: Vitals, Medications, Diet, and Lab Tests
 */
export const getPatientHourlyRecord = asyncHandler(async (req: Request, res: Response) => {
    const { admissionId } = req.params;
    const hospital = (req as any).user.hospital;

    const admission = await IPDAdmission.findOne({
        $or: [
            { admissionId: admissionId },
            { _id: mongoose.isValidObjectId(admissionId) ? admissionId : null }
        ],
        hospital
    })
        .populate({ path: "patient", select: "name mobile gender dateOfBirth" })
        .populate({ path: "primaryDoctor", populate: { path: "user", select: "name" } });

    if (!admission) throw new ApiError(404, "Admission not found");

    // Fetch all related records for this admission
    const [vitals, allMeds, labOrders, occupancies, diet] = await Promise.all([
        VitalsRecord.find({ admission: admission._id })
            .populate('recordedBy', 'name')
            .sort({ timestamp: 1 }),
        MedicationRecord.find({ admission: admission._id })
            .populate('administeredBy', 'name')
            .sort({ timestamp: 1 }),
        LabOrder.find({
            $or: [
                { admission: admission._id },
                {
                    patient: (admission.patient as any)?._id || admission.patient,
                    createdAt: { $gte: admission.admissionDate }
                }
            ]
        })
            .populate('tests.test')
            .populate('doctor', 'name')
            .sort({ createdAt: 1 }),
        BedOccupancy.find({
            admission: admission._id
        }).populate('bed').sort({ startDate: 1 }),
        DietLog.find({ admission: admission._id })
            .populate('recordedBy', 'name')
            .sort({ timestamp: 1 })
    ]);

    // Apply nurse filtering and deduplication for display in history if needed
    // However, for the HOURLY LOG (Medical Record), we usually want to see ALL administrations
    // that actually happened. If we want to filter what "can" be seen by a specific nurse
    // in the monitoring UI, that's handled in the portal controllers.
    // For this report, we'll keep the actual administration records (meds) as is.
    const meds = allMeds;

    // Latest / Current occupancy
    const currentOccupancy = occupancies.find(occ => !occ.endDate);
    const bedHistory = occupancies.map(occ => ({
        ward: (occ.bed as any)?.ward || (occ.bed as any)?.type || 'N/A',
        room: (occ.bed as any)?.room || 'N/A',
        bed: (occ.bed as any)?.bedId || 'N/A',
        startDate: occ.startDate,
        endDate: occ.endDate || 'Current',
        rate: occ.dailyRateAtTime
    }));

    // Format the data for the consolidated view
    res.json({
        success: true,
        data: {
            admission: {
                admissionId: admission.admissionId,
                patientName: (admission.patient as any)?.name,
                doctorName: (admission.primaryDoctor as any)?.user?.name,
                admissionDate: admission.admissionDate,
                admissionType: admission.admissionType,
                diet: admission.diet,
                status: admission.status,
                wardName: (currentOccupancy?.bed as any)?.ward || (currentOccupancy?.bed as any)?.type || '',
                roomName: (currentOccupancy?.bed as any)?.room || '',
                bedName: (currentOccupancy?.bed as any)?.bedId || '',
                bedHistory
            },
            vitals,
            meds,
            diet,
            labOrders
        }
    });
});
