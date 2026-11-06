import mongoose from "mongoose";
import { Request, Response } from "express";
import TransactionReport from "../Models/TransactionReport.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import IPDExtraCharge from "../../IPD/Models/IPDExtraCharge.js";
import IPDAdvancePayment from "../../IPD/Models/IPDAdvancePayment.js";
import LabOrder from "../../Lab/Models/LabOrder.js";

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

const syncAllDatabaseUnderlyingCharges = async (admissionRef: any, patientId: any, reportData: any) => {
  if (!reportData) return;

  try {
    let admDoc: any = null;
    if (admissionRef) {
      if (typeof admissionRef === 'string' && admissionRef.startsWith('IPD-')) {
        admDoc = await (IPDAdmission.findOne({ admissionId: admissionRef }) as any)?.unscoped();
      } else if (mongoose.Types.ObjectId.isValid(admissionRef)) {
        admDoc = await (IPDAdmission.findById(admissionRef) as any)?.unscoped();
      }
    }
    if (!admDoc && patientId) {
      admDoc = await (IPDAdmission.findOne({ patient: patientId }).sort({ createdAt: -1 }) as any)?.unscoped();
    }

    const admId = admDoc?._id;

    // 1. Sync IPDAdmission & BedOccupancy (Admission & Stay Date)
    const firstAdmStartDate = reportData.admissions?.[0]?.date;
    if (firstAdmStartDate && admDoc) {
      const parsedDate = new Date(firstAdmStartDate);
      if (!isNaN(parsedDate.getTime())) {
        admDoc.admissionDate = parsedDate;
        await admDoc.save();

        await (BedOccupancy.updateMany(
          { admission: admId },
          { $set: { startDate: parsedDate } }
        ) as any)?.unscoped();
        console.log(`[SYNC DB] Synced IPDAdmission ${admDoc.admissionId} and BedOccupancy to ${parsedDate.toISOString()}`);
      }
    }

    // 2. Sync Services / Nursing Charges (IPDExtraCharge)
    if (Array.isArray(reportData.services) && (admId || patientId)) {
      for (const s of reportData.services) {
        if (!s.date) continue;
        const sDate = new Date(s.date);
        if (isNaN(sDate.getTime())) continue;

        const updateFields: any = { date: sDate, createdAt: sDate };
        if (s.rate !== undefined) updateFields.amount = s.amount || (s.rate * (Number(s.quantity) || 1));

        const orConditions: any[] = [];
        if (admId) orConditions.push({ admission: admId });
        if (patientId) orConditions.push({ patient: patientId });

        const query: any = {
          $or: orConditions,
        };
        if (s.serviceName) {
          query.description = new RegExp(s.serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        await (IPDExtraCharge.updateMany(query, { $set: updateFields }) as any)?.unscoped();
        console.log(`[SYNC DB] Synced IPDExtraCharge ${s.serviceName} to ${sDate.toISOString()}`);
      }
    }

    // 3. Sync Diagnostics / Lab Tests (LabOrder & IPDExtraCharge)
    if (Array.isArray(reportData.diags) && (admId || patientId)) {
      for (const d of reportData.diags) {
        if (!d.date) continue;
        const dDate = new Date(d.date);
        if (isNaN(dDate.getTime())) continue;

        const orConditions: any[] = [];
        if (admId) orConditions.push({ admission: admId });
        if (patientId) orConditions.push({ patient: patientId });

        const query: any = {
          $or: orConditions,
        };
        if (d.testName) {
          query['tests.testName'] = new RegExp(d.testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        await (LabOrder.updateMany(query, { $set: { createdAt: dDate, updatedAt: dDate } }) as any)?.unscoped();

        const extraLabQuery: any = {
          $or: orConditions,
          category: { $in: ['Lab', 'Diagnostics', 'Investigation'] },
        };
        if (d.testName) {
          extraLabQuery.description = new RegExp((d.testName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }
        await (IPDExtraCharge.updateMany(extraLabQuery, { $set: { date: dDate, createdAt: dDate } }) as any)?.unscoped();
        console.log(`[SYNC DB] Synced LabOrder & Lab ExtraCharge ${d.testName} to ${dDate.toISOString()}`);
      }
    }

    // 4. Sync Payments / Receipts (IPDAdvancePayment)
    if (Array.isArray(reportData.payments)) {
      for (const p of reportData.payments) {
        if (!p.date) continue;
        const pDate = new Date(p.date);
        if (isNaN(pDate.getTime())) continue;

        const query: any = {};
        if (p.receiptNumber || p.receiptNo) {
          query.receiptNumber = p.receiptNumber || p.receiptNo;
        } else if (admId) {
          query.admission = admId;
        } else if (patientId) {
          query.patient = patientId;
        }

        await (IPDAdvancePayment.updateMany(query, { $set: { date: pDate, createdAt: pDate } }) as any)?.unscoped();
        console.log(`[SYNC DB] Synced IPDAdvancePayment ${p.receiptNumber} to ${pDate.toISOString()}`);
      }
    }
  } catch (syncErr) {
    console.warn("[syncAllDatabaseUnderlyingCharges] Non-blocking DB sync warning:", syncErr);
  }
};

export const saveTransactionReport = async (req: Request, res: Response) => {
  try {
    const { patientId, reportData, totals, generatedBy, isOPD, admission, admissionId, templateFormat, date } = req.body;
    const hospitalId = (req as any).hospitalId;

    if (!patientId || !reportData || !totals) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    console.log(`[SAVE DEBUG] Saving report for patient ${patientId} at hospital ${hospitalId}`);
    
    const sanitizedReportData = sanitizeReportData(reportData);

    if (!sanitizedReportData.doctorReference || !sanitizedReportData.guardianName || !sanitizedReportData.guardianMobile) {
      const pProfile = await (PatientProfile.findOne({
        user: patientId,
        hospital: hospitalId,
      }) as any)?.unscoped().select("doctorReference referredBy GuardianName GuardianMobile GuardianRelation").lean();
      if (!sanitizedReportData.doctorReference && (pProfile?.doctorReference || pProfile?.referredBy)) {
        sanitizedReportData.doctorReference = pProfile.doctorReference || pProfile.referredBy;
        sanitizedReportData.referredBy = pProfile.doctorReference || pProfile.referredBy;
      }
      if (!sanitizedReportData.guardianName && pProfile?.GuardianName) {
        sanitizedReportData.guardianName = pProfile.GuardianName;
        sanitizedReportData.GuardianName = pProfile.GuardianName;
      }
      if (!sanitizedReportData.guardianMobile && pProfile?.GuardianMobile) {
        sanitizedReportData.guardianMobile = pProfile.GuardianMobile;
        sanitizedReportData.GuardianMobile = pProfile.GuardianMobile;
      }
    }

    const resolvedAdmission = admission || reportData?.admission?._id || reportData?.admission;
    const resolvedAdmissionId = admissionId || reportData?.admissionId || reportData?.admission?.admissionId || "";
    const resolvedFormat = templateFormat || reportData?.templateFormat || "standard";

    const report = new TransactionReport({
      patient: patientId,
      hospital: hospitalId,
      admission: resolvedAdmission || undefined,
      admissionId: resolvedAdmissionId || undefined,
      templateFormat: resolvedFormat,
      reportData: sanitizedReportData,
      totals,
      generatedBy: generatedBy || "system",
      isOPD: isOPD !== undefined ? isOPD : undefined,
      ...(date ? { date: new Date(date) } : {}),
    });

    await report.save();
    console.log("[SAVE DEBUG] Report saved successfully ID:", report._id);

    await syncAllDatabaseUnderlyingCharges(resolvedAdmission || resolvedAdmissionId, patientId, sanitizedReportData);

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
    const query: any = { patient: patientId };
    if (hospitalId) query.hospital = hospitalId;
    const reports = await (TransactionReport.find(query) as any).unscoped().sort({ updatedAt: -1, createdAt: -1, date: -1 }).lean();
    const profile = await (PatientProfile.findOne({
      user: patientId,
      ...(hospitalId ? { hospital: hospitalId } : {})
    }) as any)?.unscoped().select("doctorReference referredBy GuardianName GuardianMobile GuardianRelation").lean();

    const sanitizedReports = reports.map((r: any) => {
      const docRef = r.reportData?.doctorReference || r.reportData?.referredBy || profile?.doctorReference || profile?.referredBy || "";
      const gName = r.reportData?.guardianName || r.reportData?.GuardianName || profile?.GuardianName || "";
      const gMob = r.reportData?.guardianMobile || r.reportData?.GuardianMobile || profile?.GuardianMobile || "";
      const cleanData = sanitizeReportData(r.reportData);
      if (cleanData) {
        cleanData.doctorReference = docRef;
        cleanData.referredBy = docRef;
        cleanData.guardianName = gName;
        cleanData.GuardianName = gName;
        cleanData.guardianMobile = gMob;
        cleanData.GuardianMobile = gMob;
      }
      return {
        ...r,
        doctorReference: docRef,
        referredBy: docRef,
        guardianName: gName,
        guardianMobile: gMob,
        reportData: cleanData,
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
    const profiles = await (PatientProfile.find({ user: { $in: patientIds } }) as any).unscoped().select("user mrn doctorReference referredBy GuardianName GuardianMobile GuardianRelation").lean();
    
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
            r.patient.guardianMobile = prof?.GuardianMobile || "";
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
    const { reportData, totals, isOPD, admission, admissionId, templateFormat, date } = req.body;
    
    if (!reportData || !totals) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const sanitizedReportData = sanitizeReportData(reportData);
    const updateData: any = { reportData: sanitizedReportData, totals };
    if (isOPD !== undefined) {
      updateData.isOPD = isOPD;
    }
    if (admission) updateData.admission = admission;
    if (admissionId) updateData.admissionId = admissionId;
    if (templateFormat) updateData.templateFormat = templateFormat;
    if (date) updateData.date = new Date(date);

    const report = await (TransactionReport.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ) as any).unscoped();

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    const targetAdmRef = updateData.admission || updateData.admissionId || report.admission || report.admissionId;
    await syncAllDatabaseUnderlyingCharges(targetAdmRef, report.patient, sanitizedReportData);

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
