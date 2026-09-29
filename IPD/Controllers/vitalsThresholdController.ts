import { Request, Response } from "express";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import VitalsThresholdTemplate from "../Models/VitalsThresholdTemplate.js";
import VitalThreshold from "../Models/VitalThreshold.js";
import IPDAdmission from "../Models/IPDAdmission.js";
import { invalidateIPDCache } from "./ipdController.js";
import fs from "fs";
import csv from "csv-parser";
import mongoose from "mongoose";

/**
 * List all vitals threshold templates for a hospital
 */
export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
    const hospital = (req as any).user.hospital;
    const templates = await VitalsThresholdTemplate.find({ hospital }).sort({ templateName: 1 });
    res.json({ success: true, data: templates });
});

/**
 * Get all thresholds for a hospital (Compatibility)
 */
export const getHospitalThresholds = asyncHandler(async (req: Request, res: Response) => {
    const { hospitalId } = req.params;
    const templates = await VitalsThresholdTemplate.find({ hospital: hospitalId });
    res.json(templates);
});

/**
 * Create a new threshold template
 */
export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
    const { templateName, wardType } = req.body;
    const hospital = (req as any).user.hospital;
    const userId = (req as any).user._id;

    if (!templateName || !wardType) {
        throw new ApiError(400, "Template name and ward type are required");
    }

    const template = await VitalsThresholdTemplate.create({
        hospital,
        templateName,
        wardType,
        createdBy: userId
    });

    res.status(201).json({ success: true, data: template });
});

/**
 * Get thresholds for a specific template
 */
export const getTemplateThresholds = asyncHandler(async (req: Request, res: Response) => {
    const { templateId } = req.params;
    const hospital = (req as any).user.hospital;

    const template = await VitalsThresholdTemplate.findOne({ _id: templateId, hospital });
    if (!template) {
        throw new ApiError(404, "Template not found");
    }

    const thresholds = await VitalThreshold.find({ templateId });
    res.json({ success: true, data: { template, thresholds } });
});

/**
 * Bulk save thresholds for a template
 */
export const saveThresholds = asyncHandler(async (req: Request, res: Response) => {
    const { templateId } = req.params;
    const { thresholds, monitoringFrequency } = req.body; // Array of IVitalThreshold objects + optional frequency
    const hospital = (req as any).user.hospital;

    const template = await VitalsThresholdTemplate.findOne({ _id: templateId, hospital });
    if (!template) {
        throw new ApiError(404, "Template not found");
    }

    // Update global template settings if provided
    if (monitoringFrequency !== undefined) {
        if (typeof monitoringFrequency === 'number') {
            template.monitoringFrequency = {
                critical: 1, // Default critical frequency to 1 hour
                warning: monitoringFrequency
            };
        } else {
            template.monitoringFrequency = monitoringFrequency;
        }
        await template.save();
    }

    // Validation
    for (const t of thresholds) {
        const {
            physicalMin, lowerCritical, lowerWarning,
            targetMin, targetMax,
            upperWarning, upperCritical, physicalMax,
            vitalName
        } = t;

        const minEscalation = Number(process.env.MIN_ESCALATION_MINUTES) || 50;
        if (t.escalationCriticalMinutes < minEscalation) {
            throw new ApiError(400, `Invalid [${vitalName}]: Escalation minutes must be at least ${minEscalation} minutes`);
        }

        // Single escalation logic: Both levels get the same time
        t.escalationWarningMinutes = t.escalationCriticalMinutes;

        // Relaxed boundary validation: min <= lowCritical <= lowerWarning <= targetMin < targetMax <= upperWarning <= upperCritical <= max
        if (!(physicalMin <= lowerCritical)) throw new ApiError(400, `Invalid [${vitalName}]: Physical Min must be less than or equal to Lower Critical`);
        if (!(lowerCritical <= lowerWarning)) throw new ApiError(400, `Invalid [${vitalName}]: Lower Critical must be less than or equal to Lower Warning`);
        if (!(lowerWarning <= targetMin)) throw new ApiError(400, `Invalid [${vitalName}]: Lower Warning cannot exceed Target Min`);
        if (!(targetMin < targetMax)) throw new ApiError(400, `Invalid [${vitalName}]: Target Min must be less than Target Max`);
        if (!(targetMax <= upperWarning)) throw new ApiError(400, `Invalid [${vitalName}]: Target Max cannot exceed Upper Warning`);
        if (!(upperWarning <= upperCritical)) throw new ApiError(400, `Invalid [${vitalName}]: Upper Warning cannot exceed Upper Critical`);
        if (!(upperCritical <= physicalMax)) throw new ApiError(400, `Invalid [${vitalName}]: Upper Critical cannot exceed Physical Max`);
    }

    // Upsert thresholds
    const ops = thresholds.map((t: any) => ({
        updateOne: {
            filter: { templateId, vitalName: t.vitalName, glucoseType: t.glucoseType },
            update: { $set: { ...t, templateId } },
            upsert: true
        }
    }));

    if (ops.length > 0) {
        await VitalThreshold.bulkWrite(ops);
    }

    // Invalidate caches if needed - here we clear hospital-wide to be safe
    await invalidateIPDCache(hospital);

    res.json({ success: true, message: "Thresholds saved successfully" });
});

/**
 * Copy an existing template
 */
export const copyTemplate = asyncHandler(async (req: Request, res: Response) => {
    const { templateId } = req.params;
    const { newTemplateName, newWardType } = req.body;
    const hospital = (req as any).user.hospital;
    const userId = (req as any).user._id;

    const sourceTemplate = await VitalsThresholdTemplate.findOne({ _id: templateId, hospital });
    if (!sourceTemplate) {
        throw new ApiError(404, "Source template not found");
    }

    const newTemplate = await VitalsThresholdTemplate.create({
        hospital,
        templateName: newTemplateName,
        wardType: newWardType || sourceTemplate.wardType,
        createdBy: userId
    });

    const sourceThresholds = await VitalThreshold.find({ templateId }).lean();
    const newThresholds = sourceThresholds.map(({ _id, ...rest }: any) => ({
        ...rest,
        templateId: newTemplate._id,
        hospital: hospital // Explicitly ensure hospital ID is carried over
    }));

    if (newThresholds.length > 0) {
        await VitalThreshold.insertMany(newThresholds);
    }

    res.status(201).json({ success: true, data: newTemplate });
});

/**
 * Get the active threshold set for a patient based on their admission ward type
 */
export const getAdmissionThresholds = asyncHandler(async (req: Request, res: Response) => {
    const { admissionId } = req.params;
    const hospital = (req as any).user.hospital;

    const admission = await IPDAdmission.findOne({
        $or: [
            { _id: mongoose.isValidObjectId(admissionId) ? admissionId : null },
            { admissionId: admissionId }
        ],
        hospital
    });
    if (!admission) {
        throw new ApiError(404, "Admission not found");
    }

    // Find template matching admission type (ward type)
    let template = await VitalsThresholdTemplate.findOne({
        hospital,
        wardType: admission.admissionType,
        isActive: true
    });

    // Fallback to "General" if ward-specific doesn't exist
    if (!template) {
        template = await VitalsThresholdTemplate.findOne({
            hospital,
            templateName: /General/i,
            isActive: true
        });
    }

    if (!template) {
        throw new ApiError(404, "No suitable vital threshold template found for this ward");
    }

    const thresholds = await VitalThreshold.find({ templateId: template._id });
    res.json({ success: true, data: { template, thresholds } });
});

/**
 * Get thresholds for a ward type (Compatibility)
 */
export const getWardThresholds = asyncHandler(async (req: Request, res: Response) => {
    const { hospitalId, wardType } = req.params;

    let template = await VitalsThresholdTemplate.findOne({
        hospital: hospitalId,
        wardType: wardType,
        isActive: true
    });

    if (!template) {
        template = await VitalsThresholdTemplate.findOne({
            hospital: hospitalId,
            templateName: /General/i,
            isActive: true
        });
    }

    if (!template) {
        return res.json({ thresholds: null });
    }

    const thresholdsList = await VitalThreshold.find({ templateId: template._id });

    // Format as lookup object for legacy frontend compatibility
    const thresholds: any = {};
    thresholdsList.forEach(t => {
        const key = t.vitalName === 'glucose' ? `${t.vitalName}_${t.glucoseType}` : t.vitalName;
        thresholds[key] = {
            minPossible: t.physicalMin,
            maxPossible: t.physicalMax,
            lowCritical: t.lowerCritical,
            lowWarning: t.lowerWarning,
            highWarning: t.upperWarning,
            highCritical: t.upperCritical
        };
    });

    res.json({ thresholds });
});

/**
 * Legacy save thresholds (Compatibility)
 */
export const saveThresholdsLegacy = asyncHandler(async (req: Request, res: Response) => {
    const { hospitalId, wardType, thresholds } = req.body;

    let template = await VitalsThresholdTemplate.findOne({
        hospital: hospitalId,
        wardType: wardType,
        isActive: true
    });

    if (!template) {
        template = await VitalsThresholdTemplate.create({
            hospital: hospitalId,
            templateName: `${wardType} Template`,
            wardType: wardType,
            createdBy: (req as any).user._id
        });
    }

    // Reuse the main save logic by calling it internally or replicating
    // For simplicity, let's replicate the core logic
    const ops = thresholds.map((t: any) => ({
        updateOne: {
            filter: { templateId: template!._id, vitalName: t.vitalName, glucoseType: t.glucoseType },
            update: { $set: { ...t, templateId: template!._id } },
            upsert: true
        }
    }));

    if (ops.length > 0) {
        await VitalThreshold.bulkWrite(ops);
    }

    await invalidateIPDCache(hospitalId);
    res.json({ success: true, message: "Thresholds saved" });
});

/**
 * Bulk import thresholds from CSV
 */
export const importThresholdsFromCSV = asyncHandler(async (req: any, res: Response) => {
    if (!req.file) throw new ApiError(400, "Please upload a CSV file");
    const hospital = req.user.hospital;
    if (!hospital) throw new ApiError(401, "Hospital context required");

    const results: any[] = [];
    const fileStream = fs.createReadStream(req.file.path);

    fileStream
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", async () => {
            try {
                // Group by unitType
                const grouped = results.reduce((acc: any, row: any) => {
                    const unit = row.roomType || row.unitType || 'General';
                    if (!acc[unit]) acc[unit] = [];
                    acc[unit].push(row);
                    return acc;
                }, {});

                for (const [unitType, rows] of Object.entries(grouped)) {
                    const rowData = rows as any[];
                    if (rowData.length === 0) continue;

                    let template = await VitalsThresholdTemplate.findOne({
                        hospital,
                        wardType: unitType
                    });

                    if (template) {
                        // Always overwrite: Wipe existing thresholds for this template
                        await VitalThreshold.deleteMany({ templateId: template._id });
                    } else {
                        template = await VitalsThresholdTemplate.create({
                            hospital,
                            templateName: `${unitType} Standard Protocol`,
                            wardType: unitType,
                            createdBy: req.user._id
                        });
                    }

                    const thresholdOps: any[] = [];
                    for (const row of rowData) {
                        const {
                            vitalName, unit, min, lowCritical, lowWarning,
                            targetRange, highWarning, highCritical, max,
                            escalationMinutes
                        } = row;

                        if (!vitalName || !targetRange) continue;

                        const [targetMin, targetMax] = targetRange.split('-').map(Number);
                        const vMin = Number(min);
                        const vLowCrit = Number(lowCritical);
                        const vLowWarn = Number(lowWarning);
                        const vHighWarn = Number(highWarning);
                        const vHighCrit = Number(highCritical);
                        const vMax = Number(max);
                        const minEscalation = Number(process.env.MIN_ESCALATION_MINUTES) || 50;
                        const escMins = Number(escalationMinutes) || minEscalation;

                        if (escMins < minEscalation) {
                            throw new ApiError(400, `Validation failed for ${vitalName} in ${unitType}. Escalation minutes must be at least ${minEscalation} minutes.`);
                        }

                        // Relaxed Boundary Validation: min <= lowCrit <= lowWarn <= targetMin < targetMax <= highWarn <= highCrit <= max
                        const isValid = (
                            vMin <= vLowCrit &&
                            vLowCrit <= vLowWarn &&
                            vLowWarn <= targetMin && // Allow low boundary to meet target
                            targetMin < targetMax &&
                            targetMax <= vHighWarn &&
                            vHighWarn <= vHighCrit &&
                            vHighCrit <= vMax
                        );

                        if (!isValid) {
                            throw new ApiError(400, `Validation failed for ${vitalName} in ${unitType}. Ensure correct order and boundaries.`);
                        }

                        thresholdOps.push({
                            templateId: template._id,
                            vitalName,
                            unit,
                            physicalMin: vMin,
                            lowerCritical: vLowCrit,
                            lowerWarning: vLowWarn,
                            targetMin,
                            targetMax,
                            upperWarning: vHighWarn,
                            upperCritical: vHighCrit,
                            physicalMax: vMax,
                            escalationCriticalMinutes: escMins,
                            escalationWarningMinutes: escMins // Single escalation logic
                        });
                    }

                    if (thresholdOps.length > 0) {
                        const finalOps = thresholdOps.map(op => ({
                            ...op,
                            hospital
                        }));
                        await VitalThreshold.insertMany(finalOps);
                    }
                }

                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                await invalidateIPDCache(hospital);

                res.status(201).json({ success: true, message: "Import completed successfully" });
            } catch (err: any) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                res.status(err.statusCode || 500).json({ message: err.message || "Import failed" });
            }
        });
});

/**
 * Update template basic info
 */
export const updateTemplate = asyncHandler(async (req: Request, res: Response) => {
    const { templateId } = req.params;
    const { templateName, wardType } = req.body;
    const hospital = (req as any).user.hospital;

    const template = await VitalsThresholdTemplate.findOneAndUpdate(
        { _id: templateId, hospital },
        { templateName, wardType },
        { new: true }
    );

    if (!template) throw new ApiError(404, "Template not found");
    res.json({ success: true, data: template });
});

/**
 * Delete template and all its thresholds
 */
export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
    const { templateId } = req.params;
    const hospital = (req as any).user.hospital;

    const template = await VitalsThresholdTemplate.findOne({ _id: templateId, hospital });
    if (!template) throw new ApiError(404, "Template not found");

    // Delete thresholds first
    await VitalThreshold.deleteMany({ templateId });
    // Delete template
    await VitalsThresholdTemplate.deleteOne({ _id: templateId });

    await invalidateIPDCache(hospital);
    res.json({ success: true, message: "Template deleted successfully" });
});

/**
 * Bulk import thresholds from JSON data (supporting preview/edit flow)
 */
export const importThresholdsJSON = asyncHandler(async (req: Request, res: Response) => {
    const { data } = req.body;
    const hospital = (req as any).user.hospital;
    if (!hospital) throw new ApiError(401, "Hospital context required");
    if (!data || !Array.isArray(data)) throw new ApiError(400, "Invalid data format");

    // Group by unitType
    const grouped = data.reduce((acc: any, row: any) => {
        const unit = row.roomType || row.unitType || 'General';
        if (!acc[unit]) acc[unit] = [];
        acc[unit].push(row);
        return acc;
    }, {});

    for (const [unitType, rows] of Object.entries(grouped)) {
        const rowData = rows as any[];
        if (rowData.length === 0) continue;

        let template = await VitalsThresholdTemplate.findOne({ hospital, wardType: unitType });

        if (template) {
            await VitalThreshold.deleteMany({ templateId: template._id });
        } else {
            template = await VitalsThresholdTemplate.create({
                hospital,
                templateName: `${unitType} Standard Protocol`,
                wardType: unitType,
                createdBy: (req as any).user._id
            });
        }

        const thresholdOps: any[] = [];
        for (const row of rowData) {
            const {
                vitalName, unit, physicalMin, lowerCritical, lowerWarning,
                targetMin, targetMax, upperWarning, upperCritical, physicalMax,
                escalationMinutes
            } = row;

            if (!vitalName) continue;

            const vMin = Number(physicalMin);
            const vLowCrit = Number(lowerCritical);
            const vLowWarn = Number(lowerWarning);
            const tMin = Number(targetMin);
            const tMax = Number(targetMax);
            const vHighWarn = Number(upperWarning);
            const vHighCrit = Number(upperCritical);
            const vMax = Number(physicalMax);
            const minEscalation = Number(process.env.MIN_ESCALATION_MINUTES) || 50;
            const escMins = Number(escalationMinutes) || minEscalation;

            if (escMins < minEscalation) {
                // Skip or throw error? Usually we throw for validation
                throw new ApiError(400, `Validation failed for ${vitalName} in ${unitType}. Escalation minutes must be at least ${minEscalation} minutes.`);
            }

            // Relaxed Boundary Validation
            const isValid = (
                vMin <= vLowCrit &&
                vLowCrit <= vLowWarn &&
                vLowWarn <= tMin &&
                tMin < tMax &&
                tMax <= vHighWarn &&
                vHighWarn <= vHighCrit &&
                vHighCrit <= vMax
            );

            if (!isValid) {
                throw new ApiError(400, `Validation failed for ${vitalName} in ${unitType}. Ensure correct order and boundaries.`);
            }

            thresholdOps.push({
                templateId: template._id,
                vitalName,
                unit,
                physicalMin: vMin,
                lowerCritical: vLowCrit,
                lowerWarning: vLowWarn,
                targetMin: tMin,
                targetMax: tMax,
                upperWarning: vHighWarn,
                upperCritical: vHighCrit,
                physicalMax: vMax,
                escalationCriticalMinutes: escMins,
                escalationWarningMinutes: escMins,
                hospital
            });
        }

        if (thresholdOps.length > 0) {
            await VitalThreshold.insertMany(thresholdOps);
        }
    }

    await invalidateIPDCache(hospital);
    res.status(201).json({ success: true, message: "Import completed successfully" });
});

