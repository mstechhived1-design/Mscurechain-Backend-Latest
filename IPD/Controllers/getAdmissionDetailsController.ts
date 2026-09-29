import { Request, Response } from "express";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import { dischargeService } from "../../services/discharge.service.js";

export const getAdmissionDetailsForDischarge = asyncHandler(async (req: Request, res: Response) => {
    const { admissionId } = req.params;

    console.log('[DISCHARGE AUTO-FILL] ========== GET ADMISSION DETAILS START ==========');
    console.log('[DISCHARGE AUTO-FILL] Admission ID:', admissionId);
    console.log('[DISCHARGE AUTO-FILL] User:', (req as any).user.email);

    try {
        const details = await dischargeService.getAdmissionDetails(admissionId);

        console.log('[DISCHARGE AUTO-FILL] Successfully retrieved admission details');
        console.log('[DISCHARGE AUTO-FILL] Patient:', details.patientName);
        console.log('[DISCHARGE AUTO-FILL] MRN:', details.mrn);
        console.log('[DISCHARGE AUTO-FILL] Doctor:', details.suggestedDoctorName);
        console.log('[DISCHARGE AUTO-FILL] ========== GET ADMISSION DETAILS COMPLETE ==========');

        res.status(200).json(details);
    } catch (error: any) {
        console.error('[DISCHARGE AUTO-FILL] ERROR:', error.message);
        console.error('[DISCHARGE AUTO-FILL] ========== GET ADMISSION DETAILS FAILED ==========');
        throw error;
    }
});
