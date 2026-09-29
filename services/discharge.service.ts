import DischargeRecord from "../Discharge/Models/DischargeRecord.js";
import Appointment from "../Appointment/Models/Appointment.js";
import redisService from "../config/redis.js";
import mongoose from "mongoose";
import { calculateBillBreakdown } from "../IPD/Controllers/IPDBillingController.js";

export interface DischargeDashboardStats {
  totalDischarges: number;
  completedToday: number;
  pendingDischarge: number;
  avgStayDuration: number; // in days
  timestamp: string;
}

export class DischargeService {
  /**
   * Get optimized discharge dashboard stats
   */
  async getDashboardStats(
    hospitalId: string,
    useCache: boolean = true,
  ): Promise<DischargeDashboardStats> {
    const cacheKey = `discharge:dashboard:stats:${hospitalId}`;

    if (useCache) {
      const cached = await redisService.get<DischargeDashboardStats>(cacheKey);
      if (cached) return cached;
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [totalDischarges, completedToday, pendingDischarge] =
      await Promise.all([
        (
          DischargeRecord.countDocuments({ hospital: hospitalId }) as any
        ).unscoped(),
        (
          DischargeRecord.countDocuments({
            hospital: hospitalId,
            createdAt: { $gte: startOfDay },
          }) as any
        ).unscoped(),
        (
          Appointment.countDocuments({
            hospital: hospitalId,
            status: "completed",
          }) as any
        ).unscoped(),
      ]);

    const stats: DischargeDashboardStats = {
      totalDischarges,
      completedToday,
      pendingDischarge,
      avgStayDuration: 0,
      timestamp: new Date().toISOString(),
    };

    await redisService.set(cacheKey, stats, 600); // 10 min cache
    return stats;
  }

  /**
   * Get admission details for discharge form auto-fill
   */
  async getAdmissionDetails(identifier: string) {
    const User = (await import("../Auth/Models/User.js")).default;
    const IPDAdmission = (await import("../IPD/Models/IPDAdmission.js"))
      .default;
    const BedOccupancy = (await import("../IPD/Models/BedOccupancy.js"))
      .default;
    const Bed = (await import("../IPD/Models/Bed.js")).default;
    const Hospital = (await import("../Hospital/Models/Hospital.js")).default;

    // 1. Try finding by admissionId directly or by Mongoose _id
    let admission = await (
      IPDAdmission.findOne({
        $or: [
          { admissionId: identifier },
          { _id: mongoose.isValidObjectId(identifier) ? identifier : null },
        ],
      }) as any
    )
      .unscoped()
      .populate("patient")
      .populate({
        path: "primaryDoctor",
        populate: [
          { path: "user", select: "name email mobile gender dateOfBirth" },
          { path: "hospital", select: "name" },
        ],
      })
      .populate(
        "hospital",
        "name address state phone logo registrationNumber hospitalId",
      )
      .lean();

    // 2. If not found, try finding by patient MRN
    if (!admission) {
      const patientUser = await (User.findOne({ mrn: identifier }) as any)
        .unscoped()
        .lean();
      if (patientUser) {
        admission = await (
          IPDAdmission.findOne({
            patient: patientUser._id,
            status: "Active",
          }) as any
        )
          .unscoped()
          .populate("patient")
          .populate({
            path: "primaryDoctor",
            populate: [
              { path: "user", select: "name email mobile gender dateOfBirth" },
              {
                path: "hospital",
                select:
                  "name address state phone logo registrationNumber hospitalId",
              },
            ],
          })
          .populate(
            "hospital",
            "name address state phone logo registrationNumber hospitalId",
          )
          .lean();
      }
    }

    if (!admission) {
      throw new Error("Admission not found");
    }

    // 3. Try finding PENDING record prepared by Nurse
    const PendingDischarge = (await import("../Discharge/Models/PendingDischarge.js")).default;
    const pendingRecord = await (PendingDischarge.findOne({ admissionId: admission.admissionId }) as any)
      .unscoped()
      .populate("createdBy", "name email")
      .populate("preparedBy", "name email")
      .lean();

    if (pendingRecord) {
      console.log("[BACKEND DEBUG] Found Pending Nurse Summary:", pendingRecord._id);
      // Merge clinical data from pending record into admission object for the result
      admission = {
        ...admission,
        ...pendingRecord, // Spread all fields from pendingRecord
        diagnosis: pendingRecord.diagnosis || admission.diagnosis,
        reasonForAdmission: pendingRecord.reasonForAdmission || admission.reasonForAdmission,
        historyOfPresentIllness: pendingRecord.historyOfPresentIllness || admission.historyOfPresentIllness,
        pastMedicalHistory: pendingRecord.pastMedicalHistory || admission.pastMedicalHistory,
        vitals: pendingRecord.vitals || admission.vitals,
        followUpDate: pendingRecord.followUpDate || admission.followUpDate,
        adviceAtDischarge: pendingRecord.adviceAtDischarge || admission.adviceAtDischarge,
        allergyHistory: pendingRecord.allergyHistory || admission.allergyHistory
      };
    }

    console.log("[BACKEND DEBUG] Admission Found:", admission._id);
    console.log("[BACKEND DEBUG] Raw Vitals:", (admission as any).vitals);

    const PatientProfile = (await import("../Patient/Models/PatientProfile.js"))
      .default;
    const DoctorProfile = (await import("../Doctor/Models/DoctorProfile.js"))
      .default;

    // Fetch comprehensive patient and doctor details
    const [patientProfile, doctorProfile, ipdHistory] = await Promise.all([
      (PatientProfile.findOne({ user: (admission.patient as any)._id }) as any)
        .unscoped()
        .lean(),
      (
        DoctorProfile.findOne({
          user: (admission.primaryDoctor as any)?.user?._id,
        }) as any
      )
        .unscoped()
        .lean(),
      (
        IPDAdmission.find({
          patient: (admission.patient as any)._id,
          _id: { $ne: admission._id },
        }) as any
      )
        .unscoped()
        .sort({ admissionDate: -1 })
        .limit(5)
        .lean(),
    ]);

    // Get bed information (find all occupancies for this admission)
    const occupancies = await (
      BedOccupancy.find({
        admission: admission._id,
      }) as any
    )
      .unscoped()
      .populate("bed")
      .sort({ startDate: 1 });

    const bedHistory = occupancies.map((occ: any) => ({
      ward: (occ.bed as any)?.ward || (occ.bed as any)?.type || "N/A",
      room: (occ.bed as any)?.room || "N/A",
      bed: (occ.bed as any)?.bedId || "N/A",
      startDate: occ.startDate,
      endDate: occ.endDate || "Current",
      rate: occ.dailyRateAtTime,
    }));

    // Resolve Current Bed Details
    const currentOccupancy = occupancies.find((occ: any) => !occ.endDate) || occupancies[occupancies.length - 1];
    const resolvedBed = currentOccupancy?.bed;

    // Resolve demographics with fallback to PatientProfile
    const patientUser = admission.patient as any;
    const dob =
      patientUser.dateOfBirth ||
      (patientProfile as any)?.dateOfBirth ||
      (patientProfile as any)?.dob;
    const gender = patientUser.gender || (patientProfile as any)?.gender;
    const bloodGroup =
      patientUser.bloodGroup || (patientProfile as any)?.bloodGroup;
    const address = patientUser.address || (patientProfile as any)?.address;

    // Calculate age from date of birth
    const calculateAge = (dob: any) => {
      if (!dob) return "";
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age.toString();
    };

    // RE-FETCH RAW ADMISSION if primaryDoctor is missing (popuplate failed)
    let rawDoctorId = null;
    if (!(admission as any).primaryDoctor) {
      const rawAdm = await (IPDAdmission.findById(admission._id) as any)
        .unscoped()
        .select("primaryDoctor")
        .lean();
      rawDoctorId = (rawAdm as any)?.primaryDoctor;
    }

    // Doctor Information Fallback
    let doctorName = (admission.primaryDoctor as any)?.user?.name;
    let doctorDepartment = (doctorProfile as any)?.department;
    let specialistType =
      (doctorProfile as any)?.specialties?.[0] ||
      (doctorProfile as any)?.specialization;

    if (!doctorName && rawDoctorId) {
      // Try finding as User ID (Data mismatch case)
      const DoctorUser = (await import("../Auth/Models/User.js")).default;
      const docUser = await (DoctorUser.findById(rawDoctorId) as any)
        .unscoped()
        .select("name");
      if (docUser) {
        doctorName = docUser.name;
      } else {
        // Try finding Profile by this ID (if it was a Profile ID but user link broken)
        const docProf = await (DoctorProfile.findById(rawDoctorId) as any)
          .unscoped()
          .populate("user", "name");
        if (docProf) {
          doctorName = (docProf as any).user?.name;
          doctorDepartment = docProf.department;
        }
      }
    }

    // Format vitals with explicit logging and mapping
    const rawVitals = (admission as any).vitals || {};
    console.log(
      "[BACKEND DEBUG] Processing Vitals. Raw Glucose:",
      rawVitals.glucose,
      "Raw Status:",
      rawVitals.status,
    );

    const processedVitals = (admission as any).vitals
      ? {
        ...(admission as any).vitals,
        sugar:
          (admission as any).vitals.glucose ||
          (admission as any).vitals.sugar ||
          "",
        status: (admission as any).vitals.status || "", // Ensure status is passed
        condition: (admission as any).vitals.condition || "", // Ensure condition is passed
      }
      : {
        height: (patientProfile as any)?.height || "",
        weight: (patientProfile as any)?.weight || "",
        bloodPressure: (patientProfile as any)?.bloodPressure || "",
        temperature: (patientProfile as any)?.temperature || "",
        pulse: (patientProfile as any)?.pulse || "",
        spO2: (patientProfile as any)?.spO2 || "",
        sugar: (patientProfile as any)?.sugar || "",
        glucose: (patientProfile as any)?.sugar || "", // Backfill glucose if only sugar exists in profile
        status: "",
        condition: "",
      };

    console.log("[BACKEND DEBUG] Final Processed Vitals:", processedVitals);

    // 🚀 LIVE FINANCIAL BREAKDOWN
    const billingBreakdown = await calculateBillBreakdown(admission.admissionId);

    // Billing Logic Safety
    const advanceVal = billingBreakdown?.financials?.totalAdvance || (admission as any).advancePaid || 0;
    const billedVal = billingBreakdown?.financials?.totalBill || (admission as any).totalBilledAmount || 0;
    const finalBillAmount = billingBreakdown?.financials?.finalAmount || billedVal;

    // Format response with all required fields (STRICT MAPPING)
    const result = {
      // Patient Demographics
      patientName: patientUser.name || "",
      age: calculateAge(dob),
      gender: gender || "",
      phone: patientUser.mobile || "",
      address: address || "",
      dob: dob || "",
      email: patientUser.email || (patientProfile as any)?.emergencyContactEmail || "",
      bloodGroup: bloodGroup || (patientProfile as any)?.bloodGroup || "",
      nationality: (patientProfile as any)?.nationality || "",
      maritalStatus: (patientProfile as any)?.maritalStatus || "",
      govtId: (patientProfile as any)?.govtId || "",
      attendantName: (patientProfile as any)?.attendantName || "",
      attendantRelationship: (patientProfile as any)?.attendantRelationship || "",
      attendantPhone: (patientProfile as any)?.attendantPhone || "",

      // Admission Identifiers
      mrn: patientUser.mrn || patientProfile?.mrn || `MRN-${patientUser._id}`,
      admissionId: (admission as any).admissionId,
      ipNo: (admission as any).admissionId,
      hospital: (admission as any).hospital?._id || (admission as any).hospital || "",

      // Location Details
      roomNo: resolvedBed?.room || (admission as any).roomNo || "",
      roomType: resolvedBed?.type || (admission as any).roomType || (admission as any).wardType || "",
      bedNo: resolvedBed?.bedId || resolvedBed?.label || (admission as any).bedNo || "",
      department: (admission as any).department || resolvedBed?.department || (doctorProfile as any)?.department || "General",
      bedHistory,
      bedCharges: billingBreakdown?.bedCharges || null,

      // Dates & Type
      admissionType: (admission as any).admissionType || "IPD",
      admissionDate: (admission as any).admissionDate,
      dischargeDate: (admission as any).dischargeDate || (admission as any).dischargeAdviceAt || null,
      dischargeAdviceAt: (admission as any).dischargeAdviceAt || (admission as any).dischargeDate || null,

      // Clinical Information
      reasonForAdmission: (admission as any).reasonForAdmission || (admission as any).chiefComplaint || (admission as any).diagnosis || (admission as any).clinicalNotes || "",
      diagnosis: (admission as any).diagnosis || "",
      provisionalDiagnosis: (admission as any).provisionalDiagnosis || "",
      chiefComplaints: (admission as any).chiefComplaints || (admission as any).chiefComplaint || (admission as any).clinicalNotes || "",
      historyOfPresentIllness: (admission as any).historyOfPresentIllness || "",
      pastMedicalHistory: (admission as any).pastMedicalHistory || (patientProfile as any)?.medicalHistory || "",
      allergyHistory: (admission as any).allergyHistory || (patientProfile as any)?.allergies || "",

      // Treatment & Course
      generalAppearance: (admission as any).generalAppearance || "",
      treatmentGiven: (admission as any).treatmentGiven || "",
      surgicalProcedures: (admission as any).surgicalProcedures || (admission as any).surgeryNotes || "",
      investigationsPerformed: (admission as any).investigationsPerformed || "",
      hospitalCourse: (admission as any).hospitalCourse || "",
      conditionAtDischarge: (admission as any).conditionAtDischarge || "Improved",

      // Advice & Follow-up
      medicationsPrescribed: (admission as any).medicationsPrescribed || "",
      adviceAtDischarge: (admission as any).adviceAtDischarge || "",
      activityRestrictions: (admission as any).activityRestrictions || "",
      followUpInstructions: (admission as any).followUpInstructions || "",
      followUpDate: (admission as any).followUpDate || null,
      dietInstructions: (admission as any).dietInstructions || (admission as any).diet || "",
      warningSigns: (admission as any).warningSigns || "",
      icdCode: (admission as any).icdCode || "",
      patientTitle: (admission as any).patientTitle || patientUser.honorific || patientUser.title || "",

      vitals: processedVitals,

      // Doctor Information
      primaryDoctor: doctorName || "",
      consultants: (admission as any).consultants || [doctorName || ""].filter(Boolean),
      suggestedDoctorName: doctorName || "",
      specialistType: specialistType || "",

      // Hospital Information
      hospitalName: (admission.hospital as any)?.name || "MsCure Advanced Health Center",
      hospitalAddress: (admission.hospital as any)?.address || "",
      hospitalState: (admission.hospital as any)?.state || "",
      hospitalPhone: (admission.hospital as any)?.phone || "",
      hospitalLogo: (admission.hospital as any)?.logo || "",
      hospitalRegNo: (admission.hospital as any)?.registrationNumber || (admission.hospital as any)?.hospitalId || "",

      // Billing (Previous payments)
      advanceAmount: advanceVal,
      remainingPaid: billingBreakdown?.financials?.totalSettlement || 0,
      totalBillAmount: finalBillAmount,
      balanceAmount: billingBreakdown?.financials?.balance || 0,
      paymentMode: (admission as any).paymentMethod || (admission as any).paymentMode || "Cash",

      // Detailed Breakdown for UI
      billingBreakdown,

      // Reference
      ipdHistory: ipdHistory.map((h: any) => ({
        admissionId: h.admissionId,
        admissionDate: h.admissionDate,
        status: h.status,
      })),

      // Meta
      createdBy: (admission as any).createdBy || null,
      preparedBy: (admission as any).preparedBy || null,
    };

    return result;
  }
}

export const dischargeService = new DischargeService();
export default dischargeService;
