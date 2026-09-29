import { Request, Response } from "express";
import TransactionReport from "../Models/TransactionReport.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";

const cleanString = (val: any, fallback: string = ""): string => {
  if (!val) return fallback;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "[object Object]" || trimmed === "object Object") return fallback;
    return trimmed;
  }
  if (typeof val === "object") {
    return (
      cleanString(val.testName) ||
      cleanString(val.name) ||
      cleanString(val.title) ||
      cleanString(val.description) ||
      cleanString(val.serviceName) ||
      cleanString(val.medicineName) ||
      cleanString(val.doctorName) ||
      cleanString(val.chargeType) ||
      fallback
    );
  }
  return String(val);
};

export const sanitizeReportData = (reportData: any): any => {
  if (!reportData || typeof reportData !== "object") return reportData;

  const sanitized = { ...reportData };

  if (Array.isArray(sanitized.doctors)) {
    sanitized.doctors = sanitized.doctors.map((d: any) => ({
      ...d,
      doctorName: cleanString(d.doctorName || d.name || d.serviceName, "Doctor Consultation"),
      specialization: cleanString(d.specialization, "Consultant"),
    }));
  }

  if (Array.isArray(sanitized.admissions)) {
    sanitized.admissions = sanitized.admissions.map((a: any) => ({
      ...a,
      chargeType: cleanString(a.chargeType, "Admission"),
      description: cleanString(a.description || a.chargeType, ""),
    }));
  }

  if (Array.isArray(sanitized.meds)) {
    sanitized.meds = sanitized.meds.map((m: any) => ({
      ...m,
      medicineName: cleanString(m.medicineName || m.name || m.description, "Medicine"),
    }));
  }

  if (Array.isArray(sanitized.services)) {
    sanitized.services = sanitized.services.map((s: any) => ({
      ...s,
      serviceName: cleanString(s.serviceName || s.name || s.description, "Service Charge"),
    }));
  }

  if (Array.isArray(sanitized.diags)) {
    sanitized.diags = sanitized.diags.map((dg: any) => ({
      ...dg,
      testName: cleanString(dg.testName || dg.name || dg.description || dg.test, "Lab Test"),
    }));
  }

  if (Array.isArray(sanitized.rads)) {
    sanitized.rads = sanitized.rads.map((r: any) => ({
      ...r,
      testName: cleanString(r.testName || r.name || r.description, "Radiology Test"),
    }));
  }

  return sanitized;
};

export const saveTransactionReport = async (req: Request, res: Response) => {
  try {
    const { patientId, reportData, totals, generatedBy, isOPD } = req.body;
    const hospitalId = (req as any).hospitalId;

    if (!patientId || !reportData || !totals) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    console.log(`[SAVE DEBUG] Saving report for patient ${patientId} at hospital ${hospitalId}`);
    
    const sanitizedReportData = sanitizeReportData(reportData);

    if (!sanitizedReportData.doctorReference) {
      const pProfile = await (PatientProfile.findOne({
        user: patientId,
        hospital: hospitalId,
      }) as any)?.unscoped().select("doctorReference referredBy GuardianName GuardianRelation").lean();
      if (pProfile?.doctorReference || pProfile?.referredBy) {
        sanitizedReportData.doctorReference = pProfile.doctorReference || pProfile.referredBy;
        sanitizedReportData.referredBy = pProfile.doctorReference || pProfile.referredBy;
      }
    }

    const report = new TransactionReport({
      patient: patientId,
      hospital: hospitalId,
      reportData: sanitizedReportData,
      totals,
      generatedBy: generatedBy || "system",
      isOPD: isOPD !== undefined ? isOPD : undefined,
    });

    await report.save();
    console.log("[SAVE DEBUG] Report saved successfully ID:", report._id);
    res.status(201).json({ success: true, report });
  } catch (error: any) {
    console.error("Error saving transaction report:", error);
    res.status(500).json({ message: error.message || "Failed to save report" });
  }
};

export const getPatientTransactionReports = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;
    const hospitalId = (req as any).hospitalId;
    const reports = await TransactionReport.find({ patient: patientId }).sort({ date: -1 }).lean();
    const profile = await (PatientProfile.findOne({
      user: patientId,
      ...(hospitalId ? { hospital: hospitalId } : {})
    }) as any)?.unscoped().select("doctorReference referredBy GuardianName GuardianRelation").lean();

    const sanitizedReports = reports.map((r: any) => {
      const docRef = r.reportData?.doctorReference || r.reportData?.referredBy || profile?.doctorReference || profile?.referredBy || "";
      return {
        ...r,
        doctorReference: docRef,
        referredBy: docRef,
        reportData: sanitizeReportData(r.reportData),
      };
    });
    res.json(sanitizedReports);
  } catch (error: any) {
    console.error("Error fetching patient transaction reports:", error);
    res.status(500).json({ message: error.message || "Failed to fetch reports" });
  }
};

export const getAllTransactionReports = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).hospitalId;
    console.log("Fetching all reports for hospital:", hospitalId);
    
    // DIAGNOSTIC: Find ALL reports in DB to see if any exist at all
    const allReportsDiagnostic = await (TransactionReport.find({}) as any).unscoped();
    console.log(`[DIAGNOSTIC] Total reports in DB (unscoped): ${allReportsDiagnostic.length}`);
    if (allReportsDiagnostic.length > 0) {
      console.log("[DIAGNOSTIC] First report hospital ID:", allReportsDiagnostic[0].hospital);
    }

    // Use unscoped() to bypass plugin for debugging and ensure we see all reports for this hospital
    const reports = await (TransactionReport.find({ hospital: hospitalId }) as any).unscoped()
      .populate("patient", "name mobile email age gender")
      .sort({ date: -1 })
      .lean();
      
    // Fetch MRNs and doctorReference from PatientProfile
    const patientIds = reports.map((r: any) => r.patient?._id).filter(Boolean);
    const profiles = await (PatientProfile.find({ user: { $in: patientIds } }) as any).unscoped().select("user mrn doctorReference referredBy GuardianName GuardianRelation").lean();
    
    const profileMap = new Map();
    profiles.forEach((p: any) => {
        if (p.user) profileMap.set(p.user.toString(), p);
    });

    const reportsWithMrn = reports.map((r: any) => {
        if (r.patient) {
            const prof = profileMap.get(r.patient._id?.toString());
            const docRef = prof?.doctorReference || prof?.referredBy || r.reportData?.doctorReference || r.reportData?.referredBy || "";
            r.patient.mrn = prof?.mrn || "N/A";
            r.patient.doctorReference = docRef;
            r.patient.referredBy = docRef;
            r.patient.guardianName = prof?.GuardianName || "";
            r.patient.guardianRelation = prof?.GuardianRelation || "";
        }
        r.reportData = sanitizeReportData(r.reportData);
        return r;
    });

    console.log(`[DEBUG] Found ${reportsWithMrn.length} reports for hospital ${hospitalId}`);
    res.json(reportsWithMrn);
  } catch (error: any) {
    console.error("Error fetching all transaction reports:", error);
    res.status(500).json({ message: error.message || "Failed to fetch reports" });
  }
};

export const updateTransactionReport = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reportData, totals, isOPD } = req.body;
    
    if (!reportData || !totals) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const sanitizedReportData = sanitizeReportData(reportData);
    const updateData: any = { reportData: sanitizedReportData, totals };
    if (isOPD !== undefined) {
      updateData.isOPD = isOPD;
    }

    const report = await TransactionReport.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    res.json({ success: true, report });
  } catch (error: any) {
    console.error("Error updating transaction report:", error);
    res.status(500).json({ message: error.message || "Failed to update report" });
  }
};

export const deleteTransactionReport = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const report = await TransactionReport.findByIdAndDelete(id);

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    res.json({ success: true, message: "Report deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting transaction report:", error);
    res.status(500).json({ message: error.message || "Failed to delete report" });
  }
};
