import { Request, Response } from "express";
import mongoose from "mongoose";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import IPDExtraCharge from "../../IPD/Models/IPDExtraCharge.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import Bed from "../../IPD/Models/Bed.js";
import IPDAdvancePayment from "../../IPD/Models/IPDAdvancePayment.js";
import IPDMedicineIssuance from "../../Pharmacy/Models/IPDMedicineIssuance.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import RadiologyOrder from "../../Prescription/Models/RadiologyOrder.js";
import Patient from "../../Patient/Models/Patient.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import TransactionReport from "../Models/TransactionReport.js";
import { calculateBillBreakdown } from "../../IPD/Controllers/IPDBillingController.js";

// Helper to calculate days between dates (min 1 day)
const calculateDays = (start: Date, end: Date | null): number => {
  const endDate = end || new Date();
  const diffTime = Math.abs(endDate.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 1;
};

// --- Category keywords for classifying extra charges into the correct section ---
const CONSULTATION_KEYWORDS = ["consultation", "doctor visit", "doctor charge", "clinical fee", "doctor fee", "consulting", "doctor", "dr ", "dr.", "dmo", "physician", "surgeon", "specialist", "visit", "on call", "round"];
const RADIOLOGY_KEYWORDS = ["radiology", "x-ray", "xray", "usg", "ct scan", "mri", "doppler", "ultrasound", "scan", "imaging"];
const INVESTIGATION_KEYWORDS = ["lab", "investigation", "diagnostic", "pathology", "blood test", "test"];
const PHARMACY_KEYWORDS = ["pharmacy", "medicine", "drug", "medication", "pharmacy issuance", "pharmacy order"];
// Everything else falls into "services" (admission, nursing, procedure, ICU, sterilium, resident doctor, incentive, etc.)

const classifyExtraCharge = (category: string, description: string): string => {
  const catLower = (category || "").toLowerCase();
  const descLower = (description || "").toLowerCase();

  // Skip pharmacy issuance entirely since it's handled by the dedicated medicine issuance section
  if (descLower.includes("pharmacy") || catLower.includes("pharmacy") || descLower.includes("medicine") || catLower.includes("medicine")) return "SKIP";

  // Consultation
  if (CONSULTATION_KEYWORDS.some(kw => catLower.includes(kw) || descLower.includes(kw))) return "consultation";

  // Radiology
  if (RADIOLOGY_KEYWORDS.some(kw => catLower.includes(kw) || descLower.includes(kw))) return "radiology";

  // Investigation/Lab
  if (INVESTIGATION_KEYWORDS.some(kw => catLower.includes(kw) || descLower.includes(kw))) return "investigation";

  // Default: services (admission, nursing, procedure, ICU, sterilium, resident doctor, incentive, etc.)
  return "services";
};

export const getIPDFinalBill = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;
    const hospitalId = (req as any).hospitalId;
    console.log(`[getIPDFinalBill] HIT for patientId=${patientId}, hospitalId=${hospitalId}`);

    // 1. Get the latest IPD Admission for this patient
    const admission = await IPDAdmission.findOne({
      patient: patientId,
      hospital: hospitalId,
    })
      .sort({ admissionDate: -1 })
      .populate({
        path: "primaryDoctor",
        populate: { path: "user", select: "name" },
      });

    if (!admission) {
      console.log(`[getIPDFinalBill] No IPD admission found for patient ${patientId}`);
      return res.status(200).json([]);
    }
    console.log(`[getIPDFinalBill] Found admission ${admission._id}`);

    // 2. Fetch Hospital details (for GST, header info)
    const hospital = await Hospital.findById(hospitalId).select("name address phone email logo gstNumber").lean();

    // 3. Fetch Patient + Profile details
    const patient = await Patient.findById(patientId).select("name mobile email").lean();
    const patientProfile = await PatientProfile.findOne({ user: patientId, hospital: hospitalId }).lean();

    // 4. Fetch current/latest bed occupancy for ward & bed info
    const currentOccupancy = await BedOccupancy.findOne({
      admission: admission._id,
    })
      .sort({ startDate: -1 })
      .populate("bed", "bedId type ward room floor");

    const bedInfo: any = currentOccupancy?.bed || {};

    // Fetch linked appointment if available (to get accurate booked doctor fee, doctor reference, and details)
    let linkedAppointment: any = await Appointment.findOne({
      $or: [
        { admissionId: admission._id },
        { appointmentId: admission.admissionId }
      ]
    }).populate({ path: "doctor", populate: { path: "user", select: "name" } }).lean();

    if (!linkedAppointment && patientId) {
      linkedAppointment = await Appointment.findOne({
        patient: patientId,
        $or: [{ isIPD: true }, { type: "IPD" }]
      }).sort({ createdAt: -1 }).populate({ path: "doctor", populate: { path: "user", select: "name" } }).lean();
    }

    if (!linkedAppointment && patientId) {
      linkedAppointment = await Appointment.findOne({
        patient: patientId,
      }).sort({ createdAt: -1 }).populate({ path: "doctor", populate: { path: "user", select: "name" } }).lean();
    }

    const resolvedDoctorReference =
      (patientProfile as any)?.doctorReference ||
      (patientProfile as any)?.referredBy ||
      linkedAppointment?.doctorReference ||
      linkedAppointment?.patientDetails?.doctorReference ||
      (patient as any)?.doctorReference ||
      (patient as any)?.referredBy ||
      (admission as any)?.doctorReference ||
      (admission as any)?.referredBy ||
      "";

    // Build patient info header
    const patientInfo = {
      name: (patient as any)?.name || "Unknown",
      mobile: (patient as any)?.mobile || (patientProfile as any)?.contactNumber || "N/A",
      mrn: (patientProfile as any)?.mrn || "N/A",
      age: (patientProfile as any)?.age || "",
      gender: (patientProfile as any)?.gender || "",
      address: (patientProfile as any)?.address || "",
      dob: (patientProfile as any)?.dob || null,
      guardianName: (patientProfile as any)?.GuardianName || "",
      guardianRelation: (patientProfile as any)?.GuardianRelation || "",
      doctorReference: resolvedDoctorReference,
      referredBy: resolvedDoctorReference,
    };

    const admissionInfo = {
      admissionId: admission.admissionId,
      admissionDate: admission.admissionDate,
      admissionType: admission.admissionType || "IPD-Cash",
      status: admission.status,
      dischargeDate: admission.dischargeDate || null,
      dischargeType: admission.status === "Discharged" ? "Normal" : "",
      doctorName: (admission.primaryDoctor as any)?.user?.name || "N/A",
      wardName: bedInfo?.ward || bedInfo?.type || "N/A",
      bedNumber: bedInfo?.bedId || "N/A",
      roomNumber: bedInfo?.room || "",
      reason: admission.reason || "",
      doctorReference: resolvedDoctorReference,
      referredBy: resolvedDoctorReference,
    };

    const hospitalInfo = {
      name: (hospital as any)?.name || "Hospital",
      address: (hospital as any)?.address || "",
      phone: (hospital as any)?.phone || "",
      email: (hospital as any)?.email || "",
      logo: (hospital as any)?.logo || "",
      gstNumber: (hospital as any)?.gstNumber || "",
    };

    const breakdown: any = await calculateBillBreakdown(admission._id.toString());
    if (!breakdown) {
      return res.status(404).json({ message: "Could not calculate bill breakdown for this admission." });
    }

    const bookedDoctorName = (admission.primaryDoctor as any)?.user?.name || (linkedAppointment?.doctor?.user as any)?.name || (linkedAppointment?.doctor as any)?.name || "Doctor Consultation";
    const bookedDoctorSpecialty = (admission.primaryDoctor as any)?.department || linkedAppointment?.doctor?.department || linkedAppointment?.doctor?.designation || (linkedAppointment?.doctor?.specialties && linkedAppointment?.doctor?.specialties[0]) || "Consultant";
    const bookedDoctorFee = Number((admission.primaryDoctor as any)?.consultationFee ?? linkedAppointment?.payment?.fee ?? linkedAppointment?.payment?.amount ?? linkedAppointment?.fee ?? linkedAppointment?.amount ?? ((admission.amount ?? 0) > 0 ? admission.amount : 0));

    // --- Build report data with 6 categories ---
    const reportData: any = {
      doctors: [],     // 1. Consultation Charges
      admissions: [],  // 2. Ward Charges
      diags: [],       // 3. Investigation Charges
      services: [],    // 4. Service Charges (admission, nursing, procedure, ICU, etc.)
      rads: [],        // 5. Radiology Charges
      meds: [],        // 6. Pharmacy Charges
      payments: [],    // Receipt details
      doctorReference: resolvedDoctorReference,
      referredBy: resolvedDoctorReference,
    };

    // --- A. Ward Charges (Bed Occupancy) ---
    (breakdown.bedCharges?.items || []).forEach((item: any, idx: number) => {
      reportData.admissions.push({
        code: `BED${idx + 1}`,
        chargeType: `Ward Charges - Bed ${item.bedId || "N/A"} (${item.type || "N/A"})`,
        rate: item.rate || 0,
        days: item.days || 1,
        amount: item.charge || 0,
      });
    });

    // --- B. Extra Charges & Orders ---
    (breakdown.extraCharges?.items || []).forEach((item: any, idx: number) => {
      const amount = item.amount || 0;
      // Skip negative pharmacy return credits (handled in returnCredits total)
      if (amount < 0 && (item.category === "Pharmacy" || item.category === "Medicine")) {
        return;
      }

      const desc = item.description || item.serviceName || item.testName || item.medicineName || "Charge";
      const codeSuffix = item._id ? item._id.toString().slice(-6).toUpperCase() : `${idx + 1}`;

      // Handle Pharmacy orders / items
      if (item.isPharmaOrder || item.category === "Pharmacy" || item.category === "Medicine" || (typeof desc === 'string' && (desc.toLowerCase().includes("pharmacy") || desc.toLowerCase().includes("medicine")))) {
        if (item.medicines && Array.isArray(item.medicines) && item.medicines.length > 0) {
          item.medicines.forEach((m: any, mIdx: number) => {
            const rawMedName = typeof m === 'string' ? m : (m?.medicineName || m?.name || m?.description || "Medicine");
            const actualMedName = typeof rawMedName === 'object'
              ? (rawMedName.medicineName || rawMedName.name || "Medicine")
              : (String(rawMedName).trim() === '[object Object]' ? 'Medicine' : String(rawMedName).trim());
            const medRate = Number(m?.rate ?? m?.price ?? m?.cost ?? 0);
            const medQty = Number(m?.quantity ?? 1);
            const medAmount = Number(m?.amount ?? (medRate * medQty));
            reportData.meds.push({
              code: `MED${codeSuffix}_${mIdx + 1}`,
              medicineName: actualMedName || "Medicine",
              rate: medRate,
              quantity: medQty,
              amount: medAmount,
            });
          });
        } else {
          const actualDesc = typeof desc === 'object'
            ? (desc.medicineName || desc.name || "Medicine")
            : (String(desc).trim() === '[object Object]' ? 'Medicine' : String(desc).trim());
          reportData.meds.push({
            code: `MED${codeSuffix}`,
            medicineName: actualDesc || "Medicine",
            rate: amount,
            quantity: 1,
            amount: amount,
          });
        }
        return;
      }

      // Handle Lab orders / items
      if (item.isLabOrder || item.category === "Lab" || item.category === "Diagnostics" || (typeof desc === 'string' && (desc.toLowerCase().includes("lab") || desc.toLowerCase().includes("investigation")))) {
        if (item.tests && Array.isArray(item.tests) && item.tests.length > 0) {
          const ratePerTest = amount / item.tests.length;
          item.tests.forEach((t: any, tIdx: number) => {
            const rawTestName = typeof t === 'string'
              ? t
              : (t?.testName || t?.name || t?.test?.testName || t?.test?.name || "Test");
            const actualTestName = typeof rawTestName === 'object'
              ? (rawTestName.testName || rawTestName.name || "Test")
              : (String(rawTestName).trim() === '[object Object]' ? 'Lab Test' : String(rawTestName).trim());

            const testRate = (typeof t === 'object' && (t.cost !== undefined || t.price !== undefined || t.amount !== undefined))
              ? Number(t.cost ?? t.price ?? t.amount ?? ratePerTest)
              : ratePerTest;

            reportData.diags.push({
              code: `LAB${codeSuffix}_${tIdx + 1}`,
              testName: actualTestName || "Test",
              rate: testRate,
              quantity: 1,
              amount: testRate,
            });
          });
        } else {
          const actualDesc = typeof desc === 'object'
            ? (desc.testName || desc.name || "Diagnostics")
            : (String(desc).trim() === '[object Object]' ? 'Diagnostics' : String(desc).trim());
          reportData.diags.push({
            code: `LAB${codeSuffix}`,
            testName: actualDesc || "Diagnostics",
            rate: amount,
            quantity: 1,
            amount: amount,
          });
        }
        return;
      }

      const actualDesc = typeof desc === 'object'
        ? (desc.serviceName || desc.doctorName || desc.name || desc.chargeType || "Charge")
        : (String(desc).trim() === '[object Object]' ? 'Charge' : String(desc).trim());

      const section = classifyExtraCharge(item.category || "", actualDesc);

      const isGenericConsultDesc = !actualDesc || actualDesc.toLowerCase() === 'consult' || actualDesc.toLowerCase() === 'consultation charges' || actualDesc.toLowerCase() === 'consultation' || actualDesc.toLowerCase() === 'doctor consultation';
      const resolvedDoctorName = (section === "consultation" && isGenericConsultDesc && bookedDoctorName) ? bookedDoctorName : actualDesc;
      const resolvedRate = (section === "consultation" && (!amount || amount <= 0) && bookedDoctorFee > 0) ? bookedDoctorFee : amount;

      const chargeItem = {
        code: `SVC${codeSuffix}`,
        serviceName: actualDesc,
        doctorName: resolvedDoctorName,
        specialization: (section === "consultation") ? bookedDoctorSpecialty : undefined,
        testName: actualDesc,
        chargeType: actualDesc,
        rate: resolvedRate,
        quantity: 1,
        visits: 1,
        days: 1,
        amount: resolvedRate,
      };

      if (section === "consultation") {
        reportData.doctors.push(chargeItem);
      } else if (section === "radiology") {
        reportData.rads.push(chargeItem);
      } else if (section === "investigation") {
        reportData.diags.push(chargeItem);
      } else {
        reportData.services.push(chargeItem);
      }
    });

    // Fallback: If no doctor consultation charge was added yet, add primary doctor's booked consultation fee
    if (reportData.doctors.length === 0 && (bookedDoctorFee > 0 || (admission.primaryDoctor as any))) {
      reportData.doctors.push({
        code: "DOC1",
        doctorName: bookedDoctorName,
        specialization: bookedDoctorSpecialty,
        rate: bookedDoctorFee > 0 ? bookedDoctorFee : (Number((admission.primaryDoctor as any)?.consultationFee) || 0),
        quantity: 1,
        visits: 1,
        days: 1,
        amount: bookedDoctorFee > 0 ? bookedDoctorFee : (Number((admission.primaryDoctor as any)?.consultationFee) || 0),
      });
    }

    // --- C. Radiology Orders (unpriced) ---
    const radiologyOrders = await RadiologyOrder.find({
      patientId: patientId,
      hospital: hospitalId,
      status: { $ne: "Cancelled" },
      createdAt: { $gte: admission.admissionDate },
    }).lean();

    radiologyOrders.forEach((order: any) => {
      const testName = `${order.modality} ${order.bodyPart}${order.protocol ? ' - ' + order.protocol : ''}`;
      const alreadyAdded = reportData.rads.some((r: any) =>
        (r.testName || "").toLowerCase().includes((order.modality || "").toLowerCase()) &&
        (r.testName || "").toLowerCase().includes((order.bodyPart || "").toLowerCase())
      );
      if (!alreadyAdded) {
        reportData.rads.push({
          code: `RAD${order._id.toString().substring(18).toUpperCase()}`,
          testName: testName,
          rate: 0,
          quantity: 1,
          amount: 0,
        });
      }
    });

    // --- D. Payments ---
    reportData.payments = (breakdown.advances || []).map((adv: any) => ({
      date: new Date(adv.date || adv.createdAt || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      receiptNo: adv.reference || adv.receiptNumber || adv.transactionId || (adv._id ? adv._id.toString().slice(-6) : "ADV"),
      receiptNumber: adv.reference || adv.receiptNumber || adv.transactionId || (adv._id ? adv._id.toString().slice(-6) : "ADV"),
      amount: adv.amount || 0,
      type: adv.transactionType || "Advance",
      mode: adv.mode || "Cash",
      paymentMode: adv.mode || "Cash",
      paymentDetails: adv.paymentDetails || undefined,
    }));

    const grandTotal = (breakdown.bedCharges?.total || 0) + (breakdown.extraCharges?.total || 0);
    const returnCredits = breakdown.financials?.returnCredits || 0;
    const discount = breakdown.financials?.discount || 0;
    const netAmount = breakdown.financials?.finalAmount !== undefined ? breakdown.financials.finalAmount : (grandTotal - returnCredits - discount);
    const totalPaid = breakdown.financials?.totalPaid || 0;
    const balance = breakdown.financials?.balance !== undefined ? breakdown.financials.balance : (netAmount - totalPaid);

    const subtotals = {
      consultation: reportData.doctors.reduce((s: number, i: any) => s + (i.amount || 0), 0),
      ward: reportData.admissions.reduce((s: number, i: any) => s + (i.amount || 0), 0),
      investigation: reportData.diags.reduce((s: number, i: any) => s + (i.amount || 0), 0),
      services: reportData.services.reduce((s: number, i: any) => s + (i.amount || 0), 0),
      radiology: reportData.rads.reduce((s: number, i: any) => s + (i.amount || 0), 0),
      pharmacy: reportData.meds.reduce((s: number, i: any) => s + (i.amount || 0), 0),
    };

    // Build the final response
    const finalBill = {
      _id: `AUTO_BILL_${admission._id}`,
      patient: patientId,
      hospital: hospitalId,
      patientInfo,
      admissionInfo,
      hospitalInfo,
      admission: admission,
      reportData,
      subtotals,
      totals: {
        grandTotal,
        returnCredits,
        discount,
        netAmount,
        totalPaid,
        balance,
      },
      doctorReference: resolvedDoctorReference,
      referredBy: resolvedDoctorReference,
      receipts: reportData.payments,
      generatedBy: "System (Auto-Generated)",
      date: new Date(),
      isAutoGenerated: true,
    };

    res.json([finalBill]); // Return as array to match getPatientTransactionReports format


  } catch (error: any) {
    console.error("Error generating IPD final bill:", error);
    res.status(500).json({ message: error.message || "Failed to generate final bill." });
  }
};

