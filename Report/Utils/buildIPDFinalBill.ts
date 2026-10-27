/**
 * Shared utility: Build the full IPD Final Bill payload for a given patient + hospital.
 * Used by ipdFinalBillController (HTTP route) and receiptController (internal enrichment).
 */
import mongoose from "mongoose";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import Patient from "../../Patient/Models/Patient.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import RadiologyOrder from "../../Prescription/Models/RadiologyOrder.js";
import { calculateBillBreakdown } from "../../IPD/Controllers/IPDBillingController.js";

const CONSULTATION_KEYWORDS = ["consultation", "doctor visit", "doctor charge", "clinical fee", "doctor fee", "consulting", "doctor", "dr ", "dr.", "dmo", "physician", "surgeon", "specialist", "visit", "on call", "round"];
const RADIOLOGY_KEYWORDS = ["radiology", "x-ray", "xray", "usg", "ct scan", "mri", "doppler", "ultrasound", "scan", "imaging"];
const INVESTIGATION_KEYWORDS = ["lab", "investigation", "diagnostic", "pathology", "blood test", "test"];

const classifyExtraCharge = (category: string, description: string): string => {
  const catLower = (category || "").toLowerCase();
  const descLower = (description || "").toLowerCase();
  if (descLower.includes("pharmacy") || catLower.includes("pharmacy") || descLower.includes("medicine") || catLower.includes("medicine")) return "SKIP";
  if (CONSULTATION_KEYWORDS.some(kw => catLower.includes(kw) || descLower.includes(kw))) return "consultation";
  if (RADIOLOGY_KEYWORDS.some(kw => catLower.includes(kw) || descLower.includes(kw))) return "radiology";
  if (INVESTIGATION_KEYWORDS.some(kw => catLower.includes(kw) || descLower.includes(kw))) return "investigation";
  return "services";
};

const calculateDays = (start: Date, end: Date | null): number => {
  const endDate = end || new Date();
  const diffTime = Math.abs(endDate.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 1;
};

export async function buildIPDFinalBillPayload(patientId: string, hospitalId: string): Promise<any | null> {
  try {
    if (!patientId || !hospitalId) return null;

    const admission: any = await IPDAdmission.findOne({
      patient: patientId,
      hospital: hospitalId,
    })
      .sort({ admissionDate: -1 })
      .populate({ path: "primaryDoctor", populate: { path: "user", select: "name" } });

    if (!admission) return null;

    const hospital: any = await Hospital.findById(hospitalId).select("name address phone email logo gstNumber cinNumber cin").lean();
    const patient: any = await Patient.findById(patientId).select("name mobile email").lean();
    const patientProfile: any = await PatientProfile.findOne({ user: patientId, hospital: hospitalId }).lean();

    const currentOccupancy: any = await BedOccupancy.findOne({ admission: admission._id })
      .sort({ startDate: -1 })
      .populate("bed", "bedId type ward room floor");
    const bedInfo: any = currentOccupancy?.bed || {};

    let linkedAppointment: any = await Appointment.findOne({
      $or: [{ admissionId: admission._id }, { appointmentId: admission.admissionId }],
    }).populate({ path: "doctor", populate: { path: "user", select: "name" } }).lean();

    if (!linkedAppointment && patientId) {
      linkedAppointment = await Appointment.findOne({ patient: patientId, $or: [{ isIPD: true }, { type: "IPD" }] })
        .sort({ createdAt: -1 })
        .populate({ path: "doctor", populate: { path: "user", select: "name" } }).lean();
    }
    if (!linkedAppointment && patientId) {
      linkedAppointment = await Appointment.findOne({ patient: patientId })
        .sort({ createdAt: -1 })
        .populate({ path: "doctor", populate: { path: "user", select: "name" } }).lean();
    }

    const resolvedDoctorReference =
      (patientProfile as any)?.doctorReference ||
      (patientProfile as any)?.referredBy ||
      linkedAppointment?.doctorReference ||
      linkedAppointment?.patientDetails?.doctorReference ||
      (patient as any)?.doctorReference ||
      (admission as any)?.doctorReference ||
      "";

    const patientInfo = {
      name: (patient as any)?.name || "Unknown",
      mobile: (patient as any)?.mobile || (patientProfile as any)?.contactNumber || "",
      mrn: (patientProfile as any)?.mrn || "",
      age: (patientProfile as any)?.age || "",
      gender: (patientProfile as any)?.gender || "",
      address: (patientProfile as any)?.address || "",
      dob: (patientProfile as any)?.dob || null,
      guardianName: (patientProfile as any)?.GuardianName || "",
      guardianRelation: (patientProfile as any)?.GuardianRelation || "",
      guardianMobile: (patientProfile as any)?.GuardianMobile || "",
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
      wardName: bedInfo?.ward || bedInfo?.type || "",
      bedNumber: bedInfo?.bedId || "",
      roomNumber: bedInfo?.room || "",
      reason: admission.reason || "",
      doctorReference: resolvedDoctorReference,
      referredBy: resolvedDoctorReference,
    };

    const hospitalInfo = {
      name: (hospital as any)?.name || "",
      address: (hospital as any)?.address || "",
      phone: (hospital as any)?.phone || "",
      email: (hospital as any)?.email || "",
      logo: (hospital as any)?.logo || "",
      gstNumber: (hospital as any)?.gstNumber || "",
      cinNumber: (hospital as any)?.cinNumber || (hospital as any)?.cin || "",
    };

    const breakdown: any = await calculateBillBreakdown(admission._id.toString());
    if (!breakdown) return null;

    const bookedDoctorName = (admission.primaryDoctor as any)?.user?.name || (linkedAppointment?.doctor?.user as any)?.name || "Doctor Consultation";
    const bookedDoctorSpecialty = (admission.primaryDoctor as any)?.department || linkedAppointment?.doctor?.department || "Consultant";
    const bookedDoctorFee = Number((admission.primaryDoctor as any)?.consultationFee ?? linkedAppointment?.payment?.fee ?? linkedAppointment?.payment?.amount ?? 0);

    const reportData: any = {
      doctors: [],
      admissions: [],
      diags: [],
      services: [],
      rads: [],
      meds: [],
      payments: [],
      doctorReference: resolvedDoctorReference,
      referredBy: resolvedDoctorReference,
    };

    // Ward charges
    (breakdown.bedCharges?.items || []).forEach((item: any, idx: number) => {
      let durationQty: string = item.readableDuration || `${Number((item.days || 1).toFixed(2))} Days`;
      durationQty = durationQty
        .replace(/Day\(s\)\s*/gi, 'Days, ')
        .replace(/Hour\(s\)/gi, 'Hours')
        .replace(/Mins/gi, 'Mins')
        .trim();
      if (durationQty.endsWith(',')) durationQty = durationQty.slice(0, -1);

      reportData.admissions.push({
        code: `BED${idx + 1}`,
        date: item.startDate || admission.admissionDate,
        chargeType: `Ward Charges - Bed ${item.bedId || "N/A"} (${item.type || "N/A"})`,
        rate: item.rate || 0,
        days: durationQty,
        quantity: durationQty,
        amount: item.charge || 0,
      });
    });

    // Extra charges
    (breakdown.extraCharges?.items || []).forEach((item: any, idx: number) => {
      const amount = item.amount || 0;
      if (amount < 0 && (item.category === "Pharmacy" || item.category === "Medicine")) return;

      const desc = item.description || item.serviceName || item.testName || item.medicineName || "Charge";
      const codeSuffix = item._id ? item._id.toString().slice(-6).toUpperCase() : `${idx + 1}`;
      const itemTimestamp = item.date || item.createdAt || admission.admissionDate;

      if (item.isPharmaOrder || item.category === "Pharmacy" || item.category === "Medicine" ||
        (typeof desc === "string" && (desc.toLowerCase().includes("pharmacy") || desc.toLowerCase().includes("medicine")))) {
        if (item.medicines && Array.isArray(item.medicines) && item.medicines.length > 0) {
          item.medicines.forEach((m: any, mIdx: number) => {
            const rawMedName = typeof m === "string" ? m : (m?.medicineName || m?.name || "Medicine");
            const actualMedName = typeof rawMedName === "object" ? (rawMedName.medicineName || rawMedName.name || "Medicine") : (String(rawMedName).trim() === "[object Object]" ? "Medicine" : String(rawMedName).trim());
            reportData.meds.push({ code: `MED${codeSuffix}_${mIdx + 1}`, date: m?.date || m?.createdAt || itemTimestamp, medicineName: actualMedName, rate: Number(m?.rate ?? 0), quantity: Number(m?.quantity ?? 1), amount: Number(m?.amount ?? 0) });
          });
        } else {
          const actualDesc = typeof desc === "object" ? (desc.medicineName || desc.name || "Medicine") : (String(desc).trim() === "[object Object]" ? "Medicine" : String(desc).trim());
          reportData.meds.push({ code: `MED${codeSuffix}`, date: itemTimestamp, medicineName: actualDesc, rate: amount, quantity: 1, amount });
        }
        return;
      }

      if (item.isLabOrder || item.category === "Lab" || item.category === "Diagnostics" ||
        (typeof desc === "string" && (desc.toLowerCase().includes("lab") || desc.toLowerCase().includes("investigation")))) {
        if (item.tests && Array.isArray(item.tests) && item.tests.length > 0) {
          const ratePerTest = amount / item.tests.length;
          item.tests.forEach((t: any, tIdx: number) => {
            const rawTestName = typeof t === "string" ? t : (t?.testName || t?.name || "Test");
            const actualTestName = typeof rawTestName === "object" ? (rawTestName.testName || rawTestName.name || "Test") : (String(rawTestName).trim() === "[object Object]" ? "Lab Test" : String(rawTestName).trim());
            const testRate = typeof t === "object" && (t.cost !== undefined || t.price !== undefined) ? Number(t.cost ?? t.price ?? ratePerTest) : ratePerTest;
            reportData.diags.push({ code: `LAB${codeSuffix}_${tIdx + 1}`, date: t?.date || t?.createdAt || itemTimestamp, testName: actualTestName, rate: testRate, quantity: 1, amount: testRate });
          });
        } else {
          const actualDesc = typeof desc === "object" ? (desc.testName || desc.name || "Diagnostics") : (String(desc).trim() === "[object Object]" ? "Diagnostics" : String(desc).trim());
          reportData.diags.push({ code: `LAB${codeSuffix}`, date: itemTimestamp, testName: actualDesc, rate: amount, quantity: 1, amount });
        }
        return;
      }

      let actualDesc = typeof desc === "object" ? (desc.serviceName || desc.doctorName || desc.name || "Charge") : (String(desc).trim() === "[object Object]" ? "Charge" : String(desc).trim());
      let resolvedRate = amount;
      let resolvedQuantity: number | string = 1;

      const qtyMatch = actualDesc.match(/\((?:Qty\/Days|Qty|Days):\s*([0-9.]+)\)/i);
      if (qtyMatch) {
        const parsedQty = parseFloat(qtyMatch[1]);
        if (!isNaN(parsedQty) && parsedQty > 0) {
          resolvedQuantity = parsedQty;
          resolvedRate = amount / parsedQty;
          actualDesc = actualDesc.replace(/\s*\((?:Qty\/Days|Qty|Days):\s*[0-9.]+\)/i, '').trim();
        }
      }

      const section = classifyExtraCharge(item.category || "", actualDesc);
      const isGenericConsultDesc = !actualDesc || ["consult", "consultation charges", "consultation", "doctor consultation"].includes(actualDesc.toLowerCase());
      const resolvedDoctorName = section === "consultation" && isGenericConsultDesc && bookedDoctorName ? bookedDoctorName : actualDesc;
      if (section === "consultation" && (!amount || amount <= 0) && bookedDoctorFee > 0) {
        resolvedRate = bookedDoctorFee;
      }

      const chargeItem = { code: `SVC${codeSuffix}`, date: itemTimestamp, serviceName: actualDesc, doctorName: resolvedDoctorName, specialization: section === "consultation" ? bookedDoctorSpecialty : undefined, testName: actualDesc, chargeType: actualDesc, rate: resolvedRate, quantity: resolvedQuantity, visits: 1, days: resolvedQuantity, amount };

      if (section === "consultation") reportData.doctors.push(chargeItem);
      else if (section === "radiology") reportData.rads.push(chargeItem);
      else if (section === "investigation") reportData.diags.push(chargeItem);
      else reportData.services.push(chargeItem);
    });

    // Fallback doctor consultation
    if (reportData.doctors.length === 0 && (bookedDoctorFee > 0 || (admission.primaryDoctor as any))) {
      reportData.doctors.push({ code: "DOC1", date: admission.admissionDate, doctorName: bookedDoctorName, specialization: bookedDoctorSpecialty, rate: bookedDoctorFee, quantity: 1, visits: 1, days: 1, amount: bookedDoctorFee });
    }

    // Radiology orders
    const radiologyOrders: any[] = await RadiologyOrder.find({
      patientId,
      hospital: hospitalId,
      status: { $ne: "Cancelled" },
      createdAt: { $gte: admission.admissionDate },
    }).lean();

    radiologyOrders.forEach((order: any) => {
      const testName = `${order.modality} ${order.bodyPart}${order.protocol ? " - " + order.protocol : ""}`;
      const alreadyAdded = reportData.rads.some((r: any) =>
        (r.testName || "").toLowerCase().includes((order.modality || "").toLowerCase()) &&
        (r.testName || "").toLowerCase().includes((order.bodyPart || "").toLowerCase())
      );
      if (!alreadyAdded) {
        reportData.rads.push({ code: `RAD${order._id.toString().substring(18).toUpperCase()}`, date: order.createdAt || admission.admissionDate, testName, rate: 0, quantity: 1, amount: 0 });
      }
    });

    // Payments
    reportData.payments = (breakdown.advances || []).map((adv: any) => ({
      date: adv.date || adv.createdAt || Date.now(),
      receiptNo: adv.reference || adv.receiptNumber || adv.transactionId || (adv._id ? adv._id.toString().slice(-6) : "ADV"),
      amount: adv.amount || 0,
      type: adv.transactionType || "Advance",
      mode: adv.mode || "Cash",
      paymentMode: adv.mode || "Cash",
      status: "Paid",
      paymentDetails: adv.paymentDetails || undefined,
    }));

    const grandTotal = (breakdown.bedCharges?.total || 0) + (breakdown.extraCharges?.total || 0);
    const returnCredits = breakdown.financials?.returnCredits || 0;
    const discount = breakdown.financials?.discount || 0;
    const netAmount = breakdown.financials?.finalAmount !== undefined ? breakdown.financials.finalAmount : (grandTotal - returnCredits - discount);
    const totalPaid = breakdown.financials?.totalPaid || 0;
    const balance = breakdown.financials?.balance !== undefined ? breakdown.financials.balance : (netAmount - totalPaid);

    return {
      _id: `AUTO_BILL_${admission._id}`,
      patient: patientId,
      hospital: hospitalId,
      patientInfo,
      admissionInfo,
      hospitalInfo,
      admission,
      reportData,
      totals: { grandTotal, returnCredits, discount, netAmount, totalPaid, balance },
      receipts: reportData.payments,
      isAutoGenerated: true,
    };
  } catch (err) {
    console.warn("[buildIPDFinalBillPayload] Error:", err);
    return null;
  }
}
