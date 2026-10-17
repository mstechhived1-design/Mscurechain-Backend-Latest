import { Request, Response } from "express";
import mongoose from "mongoose";
import DischargeSummary from "../../IPD/Models/DischargeSummary.js";

const isValidObjectId = (id: any): boolean => {
  if (!id || typeof id !== "string") return false;
  return mongoose.Types.ObjectId.isValid(id) && id.length === 24 && /^[0-9a-fA-F]{24}$/.test(id);
};

export const saveDischargeSummary = async (req: Request, res: Response) => {
  try {
    const { patientId, admissionId, admission, reportId, dischargeData, savedBy } = req.body;
    const hospitalId = (req as any).hospitalId;

    if (!patientId || !dischargeData) {
      return res.status(400).json({ message: "patientId and dischargeData are required" });
    }

    const query: any = { patient: patientId };

    // Discriminate between Mongo ObjectId and custom human-readable admission ID (e.g. IPD-HHO4210229)
    let validAdmissionObjId: any = undefined;
    let admissionCodeStr: string | undefined = undefined;

    if (admission && isValidObjectId(String(admission))) {
      validAdmissionObjId = admission;
    } else if (admissionId && isValidObjectId(String(admissionId))) {
      validAdmissionObjId = admissionId;
    }

    if (admissionId && !isValidObjectId(String(admissionId))) {
      admissionCodeStr = String(admissionId);
    } else if (admission && !isValidObjectId(String(admission))) {
      admissionCodeStr = String(admission);
    }

    if (validAdmissionObjId && admissionCodeStr) {
      query.$or = [{ admission: validAdmissionObjId }, { admissionId: admissionCodeStr }];
    } else if (validAdmissionObjId) {
      query.admission = validAdmissionObjId;
    } else if (admissionCodeStr) {
      query.admissionId = admissionCodeStr;
    }

    if (hospitalId) query.hospital = hospitalId;

    const updateDoc: any = {
      patient: patientId,
      hospital: hospitalId,
      chiefComplaints: dischargeData.chiefComplaints || "",
      historyOfPresentIllness: dischargeData.historyOfPresentIllness || "",
      pastMedicalHistory: dischargeData.pastMedicalHistory || "",
      examinationFindings: dischargeData.examinationFindings || "",
      provisionalDiagnosis: dischargeData.provisionalDiagnosis || "",
      finalDiagnosis: dischargeData.finalDiagnosis || "",
      investigations: dischargeData.investigations || "",
      treatmentAndCourse: dischargeData.treatmentAndCourse || "",
      conditionAtDischarge: dischargeData.conditionAtDischarge || "",
      dischargeMedications: dischargeData.dischargeMedications || [],
      dietAndActivityAdvice: dischargeData.dietAndActivityAdvice || "",
      woundCarePrecautions: dischargeData.woundCarePrecautions || "",
      followUpDate: dischargeData.followUpDate || "",
      warningSymptoms: dischargeData.warningSymptoms || "",
      savedBy: savedBy || "frontdesk",
    };

    if (validAdmissionObjId) updateDoc.admission = validAdmissionObjId;
    if (admissionCodeStr) updateDoc.admissionId = admissionCodeStr;
    if (reportId && isValidObjectId(String(reportId))) updateDoc.reportId = reportId;

    const doc = await DischargeSummary.findOneAndUpdate(
      query,
      { $set: updateDoc },
      { new: true, upsert: true }
    );

    res.status(200).json({ success: true, data: doc });
  } catch (error: any) {
    console.error("Error saving discharge summary:", error);
    res.status(500).json({ message: error.message || "Failed to save discharge summary" });
  }
};

export const getDischargeSummary = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;
    const { admissionId } = req.query;
    const hospitalId = (req as any).hospitalId;

    const query: any = { patient: patientId };
    if (admissionId) {
      const admStr = String(admissionId);
      if (isValidObjectId(admStr)) {
        query.$or = [{ admission: admStr }, { admissionId: admStr }];
      } else {
        query.admissionId = admStr;
      }
    }
    if (hospitalId) query.hospital = hospitalId;

    const summary = await DischargeSummary.findOne(query).sort({ updatedAt: -1 }).lean();
    res.status(200).json({ success: true, data: summary || null });
  } catch (error: any) {
    console.error("Error fetching discharge summary:", error);
    res.status(500).json({ message: error.message || "Failed to fetch discharge summary" });
  }
};
