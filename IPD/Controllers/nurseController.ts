import { Request, Response } from "express";
import mongoose from "mongoose";
import VitalsRecord from "../Models/VitalsRecord.js";
import ClinicalNote from "../Models/ClinicalNote.js";
import BedOccupancy from "../Models/BedOccupancy.js";
import { invalidateIPDCache } from "./ipdController.js";
import MedicationRecord from "../Models/MedicationRecord.js";
import IPDAdmission from "../Models/IPDAdmission.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import redisService from "../../config/redis.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import VitalsThresholdTemplate from "../Models/VitalsThresholdTemplate.js";
import VitalThreshold from "../Models/VitalThreshold.js";
import VitalsAlert from "../Models/VitalsAlert.js";
import DietLog from "../Models/DietLog.js";
import { createNotification } from "../../Notification/Controllers/notificationController.js";

// Redundant helper removed, using invalidateIPDCache instead

/**
 * Log Patient Vitals
 */
export const logVitals = asyncHandler(async (req: Request, res: Response) => {
  const {
    admissionId,
    heartRate,
    systolicBP,
    diastolicBP,
    spO2,
    temperature,
    respiratoryRate,
    glucose,
    glucoseType,
    condition,
    notes,
  } = req.body;
  const hospital = (req as any).user.hospital;
  const recordedBy = (req as any).user._id;

  // Resilient admission lookup (handles both string ID and ObjectId)
  const admission = await IPDAdmission.findOne({
    $or: [
      { admissionId: admissionId },
      { _id: mongoose.isValidObjectId(admissionId) ? admissionId : null },
    ],
    hospital,
  }).populate("primaryDoctor");

  if (!admission) throw new ApiError(404, "Admission not found");

  // Fetch patient name for notifications
  const Patient = (await import("../../Patient/Models/Patient.js")).default;
  const patientData = await Patient.findById(admission.patient)
    .select("name")
    .lean();
  const patientName = (patientData as any)?.name || "Patient";

  // Fetch dynamic template for this ward type
  let template = await VitalsThresholdTemplate.findOne({
    hospital,
    wardType: admission.admissionType,
    isActive: true,
  });

  if (!template) {
    template = await VitalsThresholdTemplate.findOne({
      hospital,
      templateName: /General/i,
      isActive: true,
    });
  }

  const thresholdList = template
    ? await VitalThreshold.find({ templateId: template._id })
    : [];
  const thresholds: any = {};
  thresholdList.forEach((t) => {
    const key =
      t.vitalName === "glucose"
        ? `${t.vitalName}_${t.glucoseType}`
        : t.vitalName;
    thresholds[key] = t;
  });

  // Severity calculation logic helper
  const calculateVitalSeverity = (
    name: string,
    val: number | undefined,
    vitalKey: string,
  ) => {
    if (val === undefined || val === null) return "Stable";
    const range = thresholds[vitalKey];
    if (!range) return "Stable"; // No config = default stable

    // Physical validation
    if (val < range.physicalMin || val > range.physicalMax) {
      throw new ApiError(
        400,
        `Invalid ${name}: Value (${val}) is outside physical limits (${range.physicalMin}-${range.physicalMax})`,
      );
    }

    // Critical Low
    if (val <= range.lowerCritical) {
      alertsToCreate.push({
        vitalName: name,
        value: val,
        severity: "Critical",
        thresholdValue: range.lowerCritical,
      });
      return "Critical";
    }

    // Warning Low
    if (val > range.lowerCritical && val <= range.lowerWarning) {
      alertsToCreate.push({
        vitalName: name,
        value: val,
        severity: "Warning",
        thresholdValue: range.lowerWarning,
      });
      return "Warning";
    }

    // Warning High
    if (val >= range.upperWarning && val < range.upperCritical) {
      // Check for SpO2 special case
      if (vitalKey === "spO2" && !range.isSpO2UpperEnabled) return "Stable";

      alertsToCreate.push({
        vitalName: name,
        value: val,
        severity: "Warning",
        thresholdValue: range.upperWarning,
      });
      return "Warning";
    }

    // Critical High
    if (val >= range.upperCritical) {
      if (vitalKey === "spO2" && !range.isSpO2UpperEnabled) return "Stable";

      alertsToCreate.push({
        vitalName: name,
        value: val,
        severity: "Critical",
        thresholdValue: range.upperCritical,
      });
      return "Critical";
    }

    return "Stable";
  };

  let status: "Stable" | "Warning" | "Critical" = "Stable";
  const alertsToCreate: any[] = [];

  const heartRateSev = calculateVitalSeverity(
    "Heart Rate",
    heartRate,
    "heartRate",
  );
  const spO2Sev = calculateVitalSeverity("SpO2", spO2, "spO2");
  const sysBPSev = calculateVitalSeverity(
    "Systolic BP",
    systolicBP,
    "systolicBP",
  );
  const diaBPSev = calculateVitalSeverity(
    "Diastolic BP",
    diastolicBP,
    "diastolicBP",
  );
  const tempSev = calculateVitalSeverity(
    "Temperature",
    temperature,
    "temperature",
  );
  const rrSev = calculateVitalSeverity(
    "Respiratory Rate",
    respiratoryRate,
    "respiratoryRate",
  );

  const glucoseKey = glucoseType ? `glucose_${glucoseType}` : "glucose_Random";
  const glucoseSev = calculateVitalSeverity("Glucose", glucose, glucoseKey);

  const allSeverities = [
    heartRateSev,
    spO2Sev,
    sysBPSev,
    diaBPSev,
    tempSev,
    rrSev,
    glucoseSev,
  ];

  if (allSeverities.includes("Critical") || condition === "Critical") {
    status = "Critical";
  } else if (
    allSeverities.includes("Warning") ||
    ["Serious", "Fair", "Warning"].includes(condition)
  ) {
    status = "Warning";
  }

  // Manual condition alerts if no numeric alerts exist for these states
  if (
    condition === "Critical" &&
    !alertsToCreate.some((a) => a.severity === "Critical")
  ) {
    alertsToCreate.push({
      vitalName: "Manual Assessment",
      value: 0,
      severity: "Critical",
      thresholdValue: 0,
      notes: "Nurse assessed as Critical",
    });
  } else if (
    (condition === "Serious" || condition === "Fair") &&
    !alertsToCreate.some(
      (a) => a.severity === "Warning" || a.severity === "Critical",
    )
  ) {
    alertsToCreate.push({
      vitalName: "Manual Assessment",
      value: 0,
      severity: "Warning",
      thresholdValue: 0,
      notes: `Nurse assessed as ${condition}`,
    });
  }

  const record = await VitalsRecord.create({
    patient: admission.patient,
    globalPatientId: admission.patient,
    admission: admission._id,
    recordedBy,
    hospital,
    heartRate,
    systolicBP,
    diastolicBP,
    spO2,
    temperature,
    respiratoryRate,
    glucose,
    glucoseType,
    status,
    condition,
    notes,
  });

  // 🏥 RESILIENT DOCTOR RECOVERY: Ensure we have a valid doctor to assign alerts to
  let resolvedDoctorId =
    admission.primaryDoctor?._id || admission.primaryDoctor;

  if (!resolvedDoctorId) {
    console.warn(
      `[Vitals Alert] No primary doctor found for admission ${admission._id}. Attempting recovery...`,
    );
    const rawAdm = await IPDAdmission.findById(admission._id).select(
      "primaryDoctor",
    );
    if (rawAdm?.primaryDoctor) {
      resolvedDoctorId = rawAdm.primaryDoctor;
    } else {
      // Last resort: If still no doctor, assign to the Hospital Admin or just use the recordedBy as temporary owner
      // This prevents the "assignedDoctor is required" validation error
      resolvedDoctorId = recordedBy;
    }
  }

  // 3. Trigger Alerts for Warning/Critical values
  if (alertsToCreate.length > 0) {
    const alertRecords = alertsToCreate.map((a) => ({
      ...a,
      patient: admission.patient,
      globalPatientId: admission.patient,
      admission: admission._id,
      vitalsRecord: record._id,
      hospital,
      assignedDoctor: resolvedDoctorId,
      status: "Active",
      auditLog: [
        {
          action: "Alert Triggered",
          user: recordedBy,
          timestamp: new Date(),
          notes: `System detected ${a.severity} value for ${a.vitalName}`,
        },
      ],
    }));
    await VitalsAlert.insertMany(alertRecords);

    // Real-time notification to Primary Doctor
    const criticalAlerts = alertRecords.filter(
      (a) => a.severity === "Critical",
    );
    const warningAlerts = alertRecords.filter((a) => a.severity === "Warning");

    const doctorUserId = (admission.primaryDoctor as any)?.user?.toString();

    if (doctorUserId && criticalAlerts.length > 0) {
      await createNotification(req, {
        recipient: doctorUserId,
        sender: recordedBy,
        type: "critical_vitals",
        message: `CRITICAL ALERT: Patient ${patientName} (${admission.admissionId}) has ${criticalAlerts.length} life-threatening vital(s).`,
        relatedId: record._id,
      });

      // ✅ NEW: Emit high-priority doctoral vital alert
      const io = (req as any).io;
      if (io) {
        const room = `doctor_${doctorUserId}`;
        io.to(room).emit("doctoral_vital_alert", {
          patientName: patientName,
          message: `CRITICAL: ${criticalAlerts.length} life-threatening vital(s) detected.`,
          severity: "CRITICAL",
          admissionId: admission.admissionId,
        });
      }
    } else if (doctorUserId && warningAlerts.length > 0) {
      await createNotification(req, {
        recipient: doctorUserId,
        sender: recordedBy,
        type: "abnormal_vitals",
        message: `Abnormal Vitals: Patient ${patientName} (${admission.admissionId}) has ${warningAlerts.length} abnormal vital(s).`,
        relatedId: record._id,
      });

      // ✅ NEW: Emit warning-level doctoral vital alert
      const io = (req as any).io;
      if (io) {
        const room = `doctor_${doctorUserId}`;
        io.to(room).emit("doctoral_vital_alert", {
          patientName: patientName,
          message: `ABNORMAL: ${warningAlerts.length} vital(s) in warning range.`,
          severity: "WARNING",
          admissionId: admission.admissionId,
        });
      }
    }
  }

  // ✅ NEW: Calculate Next Vitals Due Time
  let nextVitalsDue = new Date();
  const freq = template?.monitoringFrequency || { critical: 1, warning: 8 };

  // ICU & Emergency patients MUST be monitored hourly regardless of status
  const isICUorEmergency =
    admission.admissionType?.toLowerCase().includes("icu") ||
    admission.admissionType?.toLowerCase().includes("emergency");

  if (isICUorEmergency) {
    nextVitalsDue.setHours(nextVitalsDue.getHours() + 1);
  } else if (status === "Critical") {
    nextVitalsDue.setHours(nextVitalsDue.getHours() + (freq.critical || 1));
  } else if (status === "Warning") {
    nextVitalsDue.setHours(nextVitalsDue.getHours() + (freq.warning || 4));
  } else {
    nextVitalsDue.setHours(nextVitalsDue.getHours() + 12); // Standard monitoring
  }

  // Update snapshot in Admission and Patient Profile
  const vitalsSnapshot = {
    bloodPressure: `${systolicBP}/${diastolicBP}`,
    temperature: temperature?.toString(),
    pulse: heartRate?.toString(),
    spO2: spO2?.toString(),
    respiratoryRate: respiratoryRate?.toString(),
    glucose: glucose?.toString(),
    glucoseType,
    status,
    condition,
    notes,
  };

  const updatedAdmission = await IPDAdmission.findByIdAndUpdate(
    admission._id,
    {
      $set: {
        "vitals.bloodPressure": vitalsSnapshot.bloodPressure,
        "vitals.temperature": vitalsSnapshot.temperature,
        "vitals.pulse": vitalsSnapshot.pulse,
        "vitals.spO2": vitalsSnapshot.spO2,
        "vitals.respiratoryRate": vitalsSnapshot.respiratoryRate,
        "vitals.glucose": vitalsSnapshot.glucose,
        "vitals.glucoseType": vitalsSnapshot.glucoseType,
        "vitals.status": vitalsSnapshot.status,
        "vitals.condition": vitalsSnapshot.condition,
        "vitals.notes": vitalsSnapshot.notes,
        "vitals.lastVitalsRecordedAt": new Date(),
        "vitals.nextVitalsDue": nextVitalsDue,
      },
    },
    { new: true },
  );

  await PatientProfile.findOneAndUpdate(
    { user: admission.patient },
    { $set: vitalsSnapshot },
  );

  // Find active occupancy to invalidate specific bed cache
  const activeOccupancy = await BedOccupancy.findOne({
    admission: admission._id,
    endDate: { $exists: false },
  });
  await invalidateIPDCache(hospital, activeOccupancy?.bed?.toString());

  // ✅ NEW: Emit WebSocket event for real-time vitals update
  const io = (req as any).io;
  if (io) {
    const patientId = admission.patient.toString();
    const vitalsUpdate = {
      patientId,
      admissionId: admission.admissionId,
      vitals: {
        heartRate,
        bloodPressure: `${systolicBP}/${diastolicBP}`,
        systolicBP,
        diastolicBP,
        spO2,
        temperature,
        respiratoryRate,
        glucose,
        glucoseType,
        status,
        condition,
        timestamp: new Date(),
      },
    };

    io.to(`patient_${patientId}`).emit("vitals-updated", vitalsUpdate);
    console.log(`📡 Emitted vitals update for patient ${patientId}`);
  }

  res.status(201).json({ success: true, record });
});

/**
 * Add Clinical Note
 */
export const addClinicalNote = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      admissionId,
      type,
      subjective,
      objective,
      assessment,
      plan,
    } = req.body;
    const hospital = (req as any).user.hospital;
    const author = (req as any).user._id;

    // Resilient admission lookup (handles both string ID and ObjectId)
    const admission = await IPDAdmission.findOne({
      $or: [
        { admissionId: admissionId },
        { _id: mongoose.isValidObjectId(admissionId) ? admissionId : null },
      ],
      hospital,
    });
    if (!admission) throw new ApiError(404, "Admission not found");

    const note = await ClinicalNote.create({
      patient: admission.patient,
      globalPatientId: admission.patient,
      admission: admission._id,
      author,
      hospital,
      type,
      subjective,
      objective,
      assessment,
      plan
    });

    // Update summary in Admission snapshot
    await IPDAdmission.findByIdAndUpdate(admission._id, {
      $set: {
        clinicalNotes:
          assessment ||
          plan ||
          objective ||
          subjective ||
          "Clinical note added",
      },
    });

    const activeOccupancy = await BedOccupancy.findOne({
      admission: admission._id,
      endDate: { $exists: false },
    });
    await invalidateIPDCache(hospital, activeOccupancy?.bed?.toString());

    res.status(201).json({ success: true, note });
  },
);

export const administerMedication = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      admissionId,
      prescriptionId,
      medicineId,
      drugName,
      dose,
      route,
      status,
      timeSlot,
      notes,
    } = req.body;
    const hospital = (req as any).user.hospital;
    const administeredBy = (req as any).user._id;

    // Resilient admission lookup (handles both string ID and ObjectId)
    const admission = await IPDAdmission.findOne({
      $or: [
        { admissionId: admissionId },
        { _id: mongoose.isValidObjectId(admissionId) ? admissionId : null },
      ],
      hospital,
    });
    if (!admission) throw new ApiError(404, "Admission not found");

    const record = await MedicationRecord.create({
      patient: admission.patient,
      globalPatientId: admission.patient,
      admission: admission._id,
      prescription: prescriptionId,
      medicineId,
      administeredBy,
      hospital,
      drugName,
      dose,
      route,
      status,
      timeSlot,
      notes,
    });

    // Notify nurse and pharma portals of the update
    req.app.get("io")?.to(`hospital_${hospital}`).emit("medication_administered", {
      admissionId,
      drugName,
      recordId: record._id
    });

    res.status(201).json({ success: true, record });
  },
);

/**
 * Log Diet Intake
 */
export const logDiet = asyncHandler(async (req: Request, res: Response) => {
  const { admissionId, items, category, recordedDate, recordedTime, notes } =
    req.body;
  let hospital = (req as any).user.hospital;
  const recordedBy = (req as any).user._id;

  console.log(
    `[Diet Log Entry] Attempting to log diet for Admission: ${admissionId} by User: ${recordedBy}`,
  );

  // Fallback hospital identification for staff/nurses if user context is incomplete
  if (!hospital) {
    const StaffProfile = (await import("../../Staff/Models/StaffProfile.js"))
      .default;
    const staff = await StaffProfile.findOne({ user: recordedBy });
    if (staff) hospital = staff.hospital;
  }

  if (!hospital) {
    console.error(
      `[Diet Log] Hospital identification failed for user: ${recordedBy}`,
    );
    throw new ApiError(400, "Hospital identification failed");
  }

  // Resilient admission lookup (handles both string ID and ObjectId)
  const admission = await IPDAdmission.findOne({
    $or: [
      { admissionId: admissionId },
      { _id: mongoose.isValidObjectId(admissionId) ? admissionId : null },
    ],
    hospital,
  });

  if (!admission) {
    console.error(
      `[Diet Log] Admission not found: ${admissionId} in Hospital: ${hospital}`,
    );
    throw new ApiError(
      404,
      "Admission not found (Invalid ID or Hospital mismatch)",
    );
  }

  try {
    const record = await DietLog.create({
      patient: (admission.patient as any)?._id || admission.patient,
      globalPatientId: (admission.patient as any)?._id || admission.patient,
      admission: admission._id,
      recordedBy,
      hospital,
      items: Array.isArray(items) ? items : [items],
      category: category || "General",
      recordedDate,
      recordedTime,
      notes,
    });

    console.log(`[Diet Log Success] Record created: ${record._id}`);
    res.status(201).json({ success: true, record });
  } catch (saveError: any) {
    console.error(
      `[Diet Log Save Error] Failed to create record: ${saveError.message}`,
    );
    throw new ApiError(500, `Failed to save diet record: ${saveError.message}`);
  }
});

/**
 * Delete Diet Record
 */
export const deleteDietRecord = asyncHandler(
  async (req: Request, res: Response) => {
    const { recordId } = req.params;
    const hospital = (req as any).user.hospital;

    const record = await DietLog.findOne({ _id: recordId, hospital });
    if (!record) {
      throw new ApiError(404, "Diet record not found");
    }

    await DietLog.findByIdAndDelete(recordId);

    res.status(200).json({ success: true, message: "Diet record removed" });
  },
);

/**
 * Delete/Undo Medication Administration Record
 */
export const deleteMedicationRecord = asyncHandler(
  async (req: Request, res: Response) => {
    const { recordId } = req.params;
    const hospital = (req as any).user.hospital;

    const record = await MedicationRecord.findOne({ _id: recordId, hospital });
    if (!record) {
      throw new ApiError(404, "Medication record not found");
    }

    await MedicationRecord.findByIdAndDelete(recordId);

    // Notify portals
    req.app.get("io")?.to(`hospital_${hospital}`).emit("medication_undo", {
      admissionId: record.admission,
      recordId
    });

    res
      .status(200)
      .json({ success: true, message: "Administration record removed" });
  },
);

/**
 * Get Prescriptions for Current Admission
 */
export const getPrescriptionsByAdmissionId = asyncHandler(
  async (req: Request, res: Response) => {
    const { admissionId } = req.params;
    const hospital = (req as any).user.hospital;

    // Resilient admission lookup (handles both string ID and ObjectId)
    const admission = await IPDAdmission.findOne({
      $or: [
        { admissionId: admissionId },
        { _id: mongoose.isValidObjectId(admissionId) ? admissionId : null },
      ],
      hospital,
    });
    if (!admission) {
      console.log("Backend: Admission NOT FOUND for ID:", admissionId);
      throw new ApiError(404, "Admission not found");
    }

    console.log("Backend: Found Admission Object ID:", admission._id);

    // Cast ID to ensure exact match in $or query
    const patientId = new mongoose.Types.ObjectId(admission.patient as any);
    const hospitalId = new mongoose.Types.ObjectId(hospital as any);

    // Narrow Fallback: Find by admission._id OR (patient + hospital + created AFTER admission date)
    // We no longer use a 7-day buffer to prevent unrelated visit data leakage.
    const admissionDate = new Date(admission.admissionDate);

    const query = {
      hospital: hospitalId,
      patient: patientId,
      $or: [
        { admission: admission._id },
        {
          createdAt: { $gte: admissionDate },
          admission: { $exists: false },
        },
      ],
    };

    // 0. Fetch Administration Records to calculate 'Left' quantity accurately
    const adminRecords = await MedicationRecord.find({ admission: admission._id }).select("drugName medicineId").lean();

    // Helper for matching administered records to medicines
    const getTokens = (str: string) => {
      if (!str) return [];
      return str
        .toLowerCase()
        .replace(/\([^)]*\)/g, " ")
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1);
    };

    const getAdministeredCount = (medName: string, medId: string) => {
      const medTokens = getTokens(medName);
      if (medTokens.length === 0) return 0;

      let count = 0;
      adminRecords.forEach(rec => {
        // Match by ID if possible
        if (medId && rec.medicineId === medId.toString()) {
          count++;
          return;
        }
        // Fallback to Token matching
        const recTokens = getTokens(rec.drugName);
        const matches = medTokens.filter(mt => recTokens.includes(mt)).length;
        if (matches / medTokens.length >= 0.8 || matches / recTokens.length >= 0.8) {
          count++;
        }
      });
      return count;
    };

    // 1. Fetch standard OPD prescriptions (using global Prescription import)
    const prescriptions = await Prescription.find(query)
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
        select:
          "specialties medicalRegistrationNumber signature specialization",
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // 2. Fetch ALL PharmacyOrders for this admission (for deduplication purposes)
    const PharmacyOrderModel = (
      await import("../../Pharmacy/Models/PharmacyOrder.js")
    ).default;
    const allOrders = await PharmacyOrderModel.find(query).populate("doctor", "name").lean();

    // Collect all requested medicine names (Prescriptions + All Orders)
    const requestedNames = new Set<string>();
    prescriptions.forEach((p) =>
      (p.medicines || []).forEach((m: any) => {
        if (m.name) requestedNames.add(m.name.toLowerCase().trim());
      })
    );
    allOrders.forEach((o) =>
      (o.medicines || []).forEach((m: any) => {
        if (m.name) requestedNames.add(m.name.toLowerCase().trim());
      })
    );

    // Identify which orders to actually DISPLAY (only those NOT linked to fetched prescriptions)
    const existingPrescriptionIds = prescriptions.map((p) => p._id); // Use ObjectIds for Mongoose $nin
    const ordersToDisplay = allOrders.filter(
      (o) => !o.prescription || !existingPrescriptionIds.some((id) => id.equals(o.prescription))
    );

    // 3. Fetch Direct IPD Medicine Issuances (exclude fully returned/closed)
    const IPDMedicineIssuance = (
      await import("../../Pharmacy/Models/IPDMedicineIssuance.js")
    ).default;

    // Fetch ALL issuances (including returned/closed) to calculate exact physical stock mapping
    const issuanceQuery: any = {
      ...query
    };

    const userRole = (req as any).user.role;
    const userId = (req as any).user._id;

    if (userRole === "nurse") {
      issuanceQuery.receivedByNurse = userId;
    }

    const directIssuances = await IPDMedicineIssuance.find(issuanceQuery).lean();

    // Helper for advanced token-based fuzzy matching to detect if an item is "Extra"
    const isExtraMedicine = (productName: string) => {
      if (!productName) return false;

      // Normalize Function: Remove (), punctuation, and tokenize
      const getTokens = (str: string) => {
        return str
          .toLowerCase()
          .replace(/\([^)]*\)/g, " ") // Remove everything in parentheses
          .replace(/[^\w\s]/g, " ")     // Remove punctuation
          .split(/\s+/)
          .filter((t) => t.length > 1); // Only significant tokens
      };

      const issuedTokens = getTokens(productName);
      if (issuedTokens.length === 0) return false;

      for (const reqName of requestedNames) {
        const reqTokens = getTokens(reqName);

        // Check for strong intersection
        // If all issuance tokens are found in the requested name, it's NOT extra
        const matchCount = issuedTokens.filter((it) =>
          reqTokens.some((rt) => rt === it || rt.includes(it) || it.includes(rt)),
        ).length;

        // If >= 80% of issuance tokens match something in the request, it's likely the same
        if (matchCount / issuedTokens.length >= 0.8) return false;
      }

      return true;
    };

    // Map orders to a prescription-like format
    const mappedOrders = ordersToDisplay.map((o: any) => ({
      ...o,
      diagnosis: o.diagnosis || "Pharmacy Order",
      medicines: (o.medicines || []).map((m: any) => ({
        ...m,
        dosage: m.dosage || m.dose || "-",
        frequency: m.freq || m.frequency || "1-1-1",
        status: m.status || "pending",
      })),
      createdAt: o.createdAt || (o as any).timestamp,
      type: "pharma-order",
      paymentStatus: o.paymentStatus,
      orderStatus: o.status,
    }));

    // Map direct issuances to a prescription-like format
    // Only reflect in monitoring if they are truly "Extra" medicines AND the issuance isn't fully closed
    const mappedIssuances = directIssuances
      .filter((iss: any) => iss.status !== "RETURN_APPROVED" && iss.status !== "CLOSED")
      .map((iss: any) => {
        const extraItems = (iss.items || []).filter((m: any) => {
          const issued = m.issuedQty || 0;
          const returned = m.returnedQty || 0;
          const hasRemaining = issued > returned;
          return hasRemaining && isExtraMedicine(m.productName);
        });

        if (extraItems.length === 0) return null; // Hide issuance if no extra medicines

        return {
          ...iss,
          diagnosis: "Pharmacy Direct Issue",
          medicines: extraItems.map((m: any) => ({
            ...m,
            productId: m.product,
            name: m.productName,
            dosage: "-",
            frequency: m.frequency || "1-1-1",
            quantity: (m.issuedQty || 0) - (m.returnedQty || 0),
            consumedCount: getAdministeredCount(m.productName, m.product?.toString()),
            status:
              iss.status === "RETURN_REQUESTED" ? "return-pending" : "issued",
          })),
          createdAt: iss.issuedAt || iss.createdAt,
          type: "pharma-issuance",
        };
      })
      .filter(Boolean);

    const MedicineReturnModel = (await import("../../Pharmacy/Models/MedicineReturn.js")).default;
    const pendingReturns = await MedicineReturnModel.find({
      admissionId: admission.admissionId,
      hospital,
      status: "PENDING"
    }).lean();

    const getStockForPrescribedItem = (medName: string, medId: string) => {
      const medTokens = getTokens(medName);
      if (medTokens.length === 0) return null;

      let totalIssued = 0;
      let totalReturned = 0;
      let totalPendingReturn = 0;
      let found = false;

      directIssuances.forEach((iss: any) => {
        (iss.items || []).forEach((item: any) => {
          const isMatch = (medId && item.product?.toString() === medId?.toString()) || (() => {
            const itemTokens = getTokens(item.productName);
            const matches = medTokens.filter((mt: string) => itemTokens.includes(mt)).length;
            return matches / medTokens.length >= 0.8 || (itemTokens.length > 0 && matches / itemTokens.length >= 0.8);
          })();

          if (isMatch) {
            found = true;
            totalIssued += (item.issuedQty || 0);
            totalReturned += (item.returnedQty || 0);
          }
        });
      });

      // Also deduct any quantities the nurse has currently placed in the return bin (pending pharmacy approval)
      pendingReturns.forEach((pr: any) => {
        (pr.items || []).forEach((item: any) => {
          const isMatch = (medId && item.product?.toString() === medId?.toString()) || (() => {
            const itemTokens = getTokens(item.productName);
            const matches = medTokens.filter((mt: string) => itemTokens.includes(mt)).length;
            return matches / medTokens.length >= 0.8 || (itemTokens.length > 0 && matches / itemTokens.length >= 0.8);
          })();

          if (isMatch) {
            totalPendingReturn += (item.returnedQty || 0);
          }
        });
      });

      return found ? { quantity: totalIssued - totalReturned - totalPendingReturn } : null;
    };

    const mergedPrescs = [
      ...prescriptions,
      ...mappedOrders,
      ...mappedIssuances,
    ].sort(
      (a: any, b: any) =>
        new Date(b.createdAt || b.timestamp).getTime() -
        new Date(a.createdAt || a.timestamp).getTime(),
    ).map(p => ({
      ...p,
      medicines: (p.medicines || []).map((m: any) => {
        const stockInfo = getStockForPrescribedItem(m.name, m.productId || m.medicineId);
        return {
          ...m,
          consumedCount: m.consumedCount !== undefined ? m.consumedCount : getAdministeredCount(m.name, m.productId || m.medicineId),
          quantity: stockInfo ? stockInfo.quantity : (m.quantity || "0"),
          isPharmaTracked: !!stockInfo || m.sourceType === 'pharma-issuance' || p.type === 'pharma-order'
        };
      })
    }));

    // Final Deduplication: If a medicine (by tokens) already exists in a "higher" source, skip it.
    // Order of priority: Prescription (standard) > pharma-order > pharma-issuance
    const finalPrescs: any[] = [];
    const seenMeds = new Set<string>();

    const getNormalizedKey = (item: any) => {
      // We use the brand/name stripped of parens for deduping the final list too
      return item.name?.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^\w\s]/g, " ").trim().split(/\s+/).sort().join(" ");
    };

    for (const p of mergedPrescs) {
      const medicines = (p.medicines || []).filter((m: any) => {
        const key = getNormalizedKey(m);
        if (!key) return true;

        // Check against seen tokens (fuzzy match)
        for (const seenKey of seenMeds) {
          const seenTokens = seenKey.split(" ");
          const currentTokens = key.split(" ");

          const matches = currentTokens.filter(ct => seenTokens.includes(ct)).length;
          if (matches / currentTokens.length >= 0.8 || matches / seenTokens.length >= 0.8) {
            return false; // Already seen this med in a more recent/primary source
          }
        }

        seenMeds.add(key);
        return true;
      });

      if (medicines.length > 0) {
        finalPrescs.push({ ...p, medicines });
      }
    }

    const allPrescs = finalPrescs;

    console.log(
      `[Nurse Debug] ADM: ${admissionId}, Query From: ${admissionDate}`,
    );
    console.log(
      `[Nurse Debug] DB Counts -> Prescriptions: ${prescriptions.length}, PharmaOrders: ${allOrders.length}`,
    );
    console.log(`[Nurse Debug] TOTAL Merged: ${allPrescs.length}`);

    if (allPrescs.length > 0) {
      console.log(
        `[Nurse Debug] Latest Med Diagnosis: ${allPrescs[0].diagnosis}`,
      );
    }

    res.json(allPrescs);
  },
);

/**
 * Get Lab Reports for Current Admission
 */
export const getLabReportsByAdmissionId = asyncHandler(
  async (req: Request, res: Response) => {
    const { admissionId } = req.params;
    const hospital = (req as any).user.hospital;

    // Resilient admission lookup (handles both string ID and ObjectId)
    const admission = await IPDAdmission.findOne({
      $or: [
        { admissionId: admissionId },
        { _id: mongoose.isValidObjectId(admissionId) ? admissionId : null },
      ],
      hospital,
    });
    if (!admission) {
      console.log("Backend: Admission NOT FOUND (Labs) for ID:", admissionId);
      throw new ApiError(404, "Admission not found");
    }

    const query = {
      $or: [
        { admission: admission._id },
        {
          patient: admission.patient,
          createdAt: { $gte: admission.admissionDate },
        },
      ],
    };

    const reports = await LabOrder.find(query)
      .populate("tests.test")
      .populate("doctor", "name")
      .sort({ createdAt: -1 });

    console.log(
      `Backend: Found ${reports.length} lab reports for Admission _id: ${admission._id} (using fallback: true)`,
    );

    res.json(reports);
  },
);

/**
 * Get Focused Patient Record (Unified)
 */
export const getPatientClinicalHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const { admissionId } = req.params;
    const hospital = (req as any).user.hospital;

    // Resilient admission lookup (handles both string ID and ObjectId)
    const admission = await IPDAdmission.findOne({
      $or: [
        { admissionId: admissionId },
        { _id: mongoose.isValidObjectId(admissionId) ? admissionId : null },
      ],
      hospital,
    });
    if (!admission) throw new ApiError(404, "Admission not found");

    const [vitals, notes, meds, diet] = await Promise.all([
      VitalsRecord.find({ admission: admission._id })
        .sort({ timestamp: -1 })
        .limit(50),
      ClinicalNote.find({ admission: admission._id })
        .sort({ createdAt: -1 })
        .populate("author", "name role"),
      MedicationRecord.find({ admission: admission._id })
        .sort({ timestamp: -1 })
        .populate("administeredBy", "name"),
      DietLog.find({ admission: admission._id })
        .sort({ timestamp: -1 })
        .populate("recordedBy", "name"),
    ]);

    res.json({
      vitals,
      notes,
      meds,
      diet,
    });
  },
);
