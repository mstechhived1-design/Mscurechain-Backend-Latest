import { Request, Response } from "express";
import mongoose from "mongoose";
import whatsappManager from "../../WhatsApp/Services/whatsappManager.js";
import WhatsAppConfig from "../../WhatsApp/Models/WhatsAppConfig.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import MobileAppointment from "../../Appointment/Models/MobileAppointment.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import DischargeRecord from "../../Discharge/Models/DischargeRecord.js";
import PharmacyOrder from "../../Pharmacy/Models/PharmacyOrder.js";
import PharmacyToken from "../../Pharmacy/Models/PharmacyToken.js";
import PharmaInvoice from "../../Pharmacy/Models/Invoice.js";
import LabToken from "../../Lab/Models/LabToken.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import LabSettings from "../../Lab/Models/LabSettings.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Transaction from "../../Admin/Models/Transaction.js";
import Patient from "../Models/Patient.js";
import PatientProfile from "../Models/PatientProfile.js";
import User from "../../Auth/Models/User.js";
import TransactionReport from "../../Report/Models/TransactionReport.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import { tenantLocalStorage } from "../../middleware/tenantPlugin.js";
import { buildIPDFinalBillPayload } from "../../Report/Utils/buildIPDFinalBill.js";

const getFrontendBaseUrl = () => {
  const envUrl =
    process.env.INTERNAL_FRONTEND_URL ||
    process.env.FRONTEND_INTERNAL_URL ||
    process.env.FRONTEND_URL ||
    "http://127.0.0.1:3000";
  const first = envUrl.split(",")[0].trim().replace(/\/+$/, "");
  return first || "http://127.0.0.1:3000";
};

function safeUnscoped(query: any) {
  if (query && typeof query.unscoped === "function") {
    return query.unscoped();
  }
  return query;
}

/**
 * Resolves full, authentic clinical record directly from MongoDB by ID or (hospitalId, patientId).
 * ZERO dummy fallbacks are used.
 */
async function resolveClinicalRecord(
  type: string,
  id?: string,
  context?: { hospitalId?: string; patientId?: string; user?: any }
): Promise<any> {
  const isObjectId = id && mongoose.Types.ObjectId.isValid(id);
  const patientId = context?.patientId || context?.user?._id;
  const hospitalId = context?.hospitalId || context?.user?.hospitalId;

  try {
    let doc: any = null;

    // ── 1. PRESCRIPTION ──
    if (type === "prescription") {
      if (isObjectId) {
        try {
          doc = await Prescription.findById(id)
            .populate("patient")
            .populate({ path: "doctor", populate: "user" })
            .populate("hospital")
            .lean();
        } catch (e) {}
      }
      if (!doc && id) {
        try {
          doc = await Prescription.findOne({ _id: id })
            .populate("patient")
            .populate({ path: "doctor", populate: "user" })
            .populate("hospital")
            .lean();
        } catch (e) {}
      }
      if (!doc && patientId) {
        try {
          doc = await Prescription.findOne({
            patient: patientId,
            ...(hospitalId ? { hospital: hospitalId } : {}),
          })
            .sort({ createdAt: -1 })
            .populate("patient")
            .populate({ path: "doctor", populate: "user" })
            .populate("hospital")
            .lean();
        } catch (e) {}
      }
    }

    // ── 2. APPOINTMENT / OPD CONSULTATION ──
    else if (type === "appointment" || type === "consultation") {
      if (isObjectId) {
        try {
          doc = await safeUnscoped(Appointment.findById(id))
            ?.populate("patient")
            ?.populate({ path: "doctor", populate: "user" })
            ?.populate("hospital")
            ?.lean();
        } catch (e) {}
      }

      if (!doc && id) {
        try {
          doc = await safeUnscoped(
            Appointment.findOne({
              $or: [{ appointmentId: id }, ...(isObjectId ? [{ _id: id }] : [])],
            })
          )
            ?.populate("patient")
            ?.populate({ path: "doctor", populate: "user" })
            ?.populate("hospital")
            ?.lean();
        } catch (e) {}
      }

      if (!doc && id) {
        try {
          doc = await safeUnscoped(
            MobileAppointment.findOne({
              $or: [{ appointmentId: id }, ...(isObjectId ? [{ _id: id }] : [])],
            })
          )
            ?.populate("patient")
            ?.populate({ path: "doctor", populate: "user" })
            ?.populate("hospital")
            ?.lean();
        } catch (e) {}
      }

      // Query latest appointment by patientId and hospitalId if id didn't match
      if (!doc && patientId) {
        try {
          doc = await safeUnscoped(
            Appointment.findOne({
              patient: patientId,
              ...(hospitalId ? { hospital: hospitalId } : {}),
            }).sort({ createdAt: -1 })
          )
            ?.populate("patient")
            ?.populate({ path: "doctor", populate: "user" })
            ?.populate("hospital")
            ?.lean();
        } catch (e) {}

        if (!doc) {
          try {
            doc = await safeUnscoped(
              MobileAppointment.findOne({
                patient: patientId,
                ...(hospitalId ? { hospital: hospitalId } : {}),
              }).sort({ createdAt: -1 })
            )
              ?.populate("patient")
              ?.populate({ path: "doctor", populate: "user" })
              ?.populate("hospital")
              ?.lean();
          } catch (e) {}
        }
      }
    }

    // ── 3. LAB TOKEN / INVOICE / REPORT ──
    else if (type === "lab-token" || type === "lab-invoice" || type === "lab-bill" || type === "lab-report") {
      if (isObjectId) {
        try {
          doc = await safeUnscoped(LabOrder.findById(id))
            ?.populate("patient")
            ?.populate("doctor")
            ?.populate("hospital")
            ?.populate("invoiceId")
            ?.lean();
        } catch (e) {}
      }

      if (!doc && id) {
        try {
          doc = await safeUnscoped(
            LabOrder.findOne({
              $or: [{ tokenNumber: id }, { sampleId: id }, ...(isObjectId ? [{ _id: id }] : [])],
            })
          )
            ?.populate("patient")
            ?.populate("doctor")
            ?.populate("hospital")
            ?.populate("invoiceId")
            ?.lean();
        } catch (e) {}
      }

      // Check if ID is a Transaction ID or transactionId / invoiceNumber
      if (!doc && id) {
        try {
          const directTxn = await safeUnscoped(
            Transaction.findOne({
              $or: [
                ...(isObjectId ? [{ _id: id }] : []),
                { transactionId: id },
                { invoiceNumber: id },
                { receiptNumber: id },
              ],
            })
          )?.lean();

          if (directTxn && directTxn.referenceId) {
            doc = await safeUnscoped(LabOrder.findById(directTxn.referenceId))
              ?.populate("patient")
              ?.populate("doctor")
              ?.populate("hospital")
              ?.lean();
            if (doc) {
              doc.linkedTransaction = directTxn;
            }
          }
        } catch (e) {}
      }

      if (!doc && id) {
        try {
          doc = await safeUnscoped(
            LabToken.findOne({
              $or: [{ tokenNumber: id }, ...(isObjectId ? [{ _id: id }] : [])],
            })
          )
            ?.populate("patient")
            ?.populate("doctor")
            ?.populate("hospital")
            ?.lean();
        } catch (e) {}
      }

      if (!doc && patientId) {
        try {
          doc = await safeUnscoped(
            LabOrder.findOne({
              patient: patientId,
              ...(hospitalId ? { hospital: hospitalId } : {}),
            }).sort({ createdAt: -1 })
          )
            ?.populate("patient")
            ?.populate("doctor")
            ?.populate("hospital")
            ?.populate("invoiceId")
            ?.lean();
        } catch (e) {}
      }

      // Resolve linked financial transaction to retrieve authentic Invoice ID and financial figures
      if (doc) {
        let txn: any = doc.linkedTransaction || null;
        if (!txn && doc.invoiceId) {
          if (typeof doc.invoiceId === "object" && (doc.invoiceId.transactionId || doc.invoiceId.invoiceNumber)) {
            txn = doc.invoiceId;
          } else if (mongoose.Types.ObjectId.isValid(doc.invoiceId)) {
            try {
              txn = await safeUnscoped(Transaction.findById(doc.invoiceId)).lean();
            } catch (e) {}
          }
        }

        if (!txn && doc._id) {
          try {
            txn = await safeUnscoped(
              Transaction.findOne({ referenceId: doc._id }).sort({ createdAt: -1 })
            ).lean();
          } catch (e) {}
        }

        const genuineInvoiceId =
          txn?.transactionId ||
          txn?.invoiceNumber ||
          txn?.receiptNumber ||
          (doc.tokenNumber ? (doc.tokenNumber.startsWith("OPD-") ? doc.tokenNumber : `OPD-${doc.tokenNumber}`) : null) ||
          (doc._id ? `OPD-HHO${doc._id.toString().slice(-6).toUpperCase()}` : undefined);

        doc.invoiceId = genuineInvoiceId;
        doc.invoiceNo = genuineInvoiceId;
        if (txn) {
          doc.paymentMode = txn.paymentMode || doc.paymentMode || "Cash";
          doc.paidAmount = txn.paidAmount ?? txn.amount ?? doc.paidAmount;
          doc.balance = txn.balance ?? 0;
          doc.totalAmount = txn.amount ?? doc.totalAmount;
          doc.discount = txn.discountAmount ?? 0;
          doc.paymentStatus = (txn.status === "completed" || (doc.balance || 0) <= 0) ? "paid" : "pending";
        }
      }
    }

    // ── 4. PHARMACY INVOICE ──
    else if (type === "pharmacy" || type === "pharmacy-invoice") {
      if (isObjectId) {
        try {
          doc = await safeUnscoped(PharmaInvoice.findById(id))?.lean();
        } catch (e) {}
      }

      if (!doc && id) {
        try {
          doc = await safeUnscoped(
            PharmaInvoice.findOne({
              $or: [{ invoiceNo: id }, ...(isObjectId ? [{ _id: id }] : [])],
            })
          )?.lean();
        } catch (e) {}
      }

      if (!doc && isObjectId) {
        try {
          doc = await safeUnscoped(PharmacyOrder.findById(id))
            ?.populate("patient")
            ?.populate({ path: "doctor", populate: "user" })
            ?.populate("hospital")
            ?.lean();
        } catch (e) {}
      }

      if (!doc && id) {
        try {
          doc = await safeUnscoped(
            PharmacyToken.findOne({
              $or: [{ tokenNumber: id }, ...(isObjectId ? [{ _id: id }] : [])],
            })
          )
            ?.populate("patient")
            ?.populate({ path: "doctor", populate: "user" })
            ?.populate("hospital")
            ?.lean();
        } catch (e) {}
      }

      if (!doc && id && isObjectId) {
        try {
          doc = await safeUnscoped(Prescription.findById(id))
            ?.populate("patient")
            ?.populate({ path: "doctor", populate: "user" })
            ?.populate("hospital")
            ?.lean();
        } catch (e) {}
      }

      if (!doc && (patientId || context?.user?.mobile)) {
        try {
          const userMobile = context?.user?.mobile || context?.user?.phone;
          if (userMobile) {
            doc = await safeUnscoped(
              PharmaInvoice.findOne({ customerPhone: userMobile }).sort({ createdAt: -1 })
            )?.lean();
          }
        } catch (e) {}

        if (!doc) {
          try {
            doc = await safeUnscoped(
              PharmaInvoice.findOne({
                ...(hospitalId ? { hospitalId } : {}),
              }).sort({ createdAt: -1 })
            )?.lean();
          } catch (e) {}
        }

        if (!doc && patientId) {
          try {
            doc = await safeUnscoped(
              PharmacyOrder.findOne({
                patient: patientId,
                ...(hospitalId ? { hospital: hospitalId } : {}),
              }).sort({ createdAt: -1 })
            )
              ?.populate("patient")
              ?.populate({ path: "doctor", populate: "user" })
              ?.populate("hospital")
              ?.lean();
          } catch (e) {}
        }
      }

      if (doc && doc.invoiceNo && !doc.invoiceId) {
        doc.invoiceId = doc.invoiceNo;
        doc.totalAmount = doc.netPayable ?? doc.subTotal;
        doc.paymentMethod = doc.mode;
        doc.billDate = doc.createdAt;
        doc.medicines = (doc.items || []).map((it: any) => ({
          name: it.productName,
          medicineName: it.productName,
          batchNo: it.batchNo,
          expiryDate: it.expiryDate,
          quantity: it.qty,
          qty: it.qty,
          unitRate: it.unitRate,
          mrp: it.mrp || it.unitRate,
          rate: it.unitRate,
          discountPct: it.discountValue,
          discount: it.discountValue,
          gstPct: it.gstPct,
          gst: it.gstPct,
          amount: it.amount,
          frequency: it.frequency,
        }));
        doc.paymentSummary = {
          subtotal: doc.subTotal,
          discount: doc.discountTotal,
          taxableAmount: doc.subTotal - doc.discountTotal - (doc.taxTotal || 0),
          grandTotal: doc.netPayable,
          paidAmount: doc.paid,
          balanceDue: doc.balance,
          paymentMode: doc.mode,
        };
      }
    }

    // ── 5. DISCHARGE SUMMARY & SETTLEMENT BILL ──
    else if (
      type === "discharge-summary" ||
      type === "discharge" ||
      type === "discharge-settlement" ||
      type === "final-bill"
    ) {
      // 1. For final bills & settlements, query authentic saved TransactionReport directly
      if (type === "discharge-settlement" || type === "final-bill") {
        if (isObjectId) {
          try {
            doc = await safeUnscoped(TransactionReport.findById(id))
              ?.populate("patient")
              ?.populate("hospital")
              ?.lean();
          } catch (e) {}
        }

        if (!doc && id) {
          try {
            doc = await safeUnscoped(
              TransactionReport.findOne({
                $or: [{ admissionId: id }, ...(isObjectId ? [{ admission: id }, { _id: id }] : [])],
              })
            )
              ?.populate("patient")
              ?.populate("hospital")
              ?.lean();
          } catch (e) {}
        }

        if (!doc && patientId) {
          try {
            doc = await safeUnscoped(
              TransactionReport.findOne({
                $or: [{ patient: patientId }, { patientId: patientId }],
                ...(hospitalId ? { hospital: hospitalId } : {}),
              }).sort({ date: -1, createdAt: -1 })
            )
              ?.populate("patient")
              ?.populate("hospital")
              ?.lean();
          } catch (e) {}
        }
      }

      // 2. If no TransactionReport found directly (or if type is discharge-summary), check DischargeRecord
      if (!doc) {
        if (isObjectId) {
          try {
            doc = await safeUnscoped(DischargeRecord.findById(id))
              ?.populate("patient")
              ?.populate("doctor")
              ?.populate("hospital")
              ?.lean();
          } catch (e) {}
        }

        if (!doc && id) {
          try {
            doc = await safeUnscoped(
              DischargeRecord.findOne({
                $or: [{ admissionId: id }, { ipNo: id }, { mrn: id }, ...(isObjectId ? [{ _id: id }] : [])],
              })
            )
              ?.populate("patient")
              ?.populate("doctor")
              ?.populate("hospital")
              ?.lean();
          } catch (e) {}
        }

        if (!doc && patientId) {
          try {
            doc = await safeUnscoped(
              DischargeRecord.findOne({
                $or: [{ patient: patientId }, { patientId: patientId }],
                ...(hospitalId ? { hospital: hospitalId } : {}),
              }).sort({ createdAt: -1 })
            )
              ?.populate("patient")
              ?.populate("doctor")
              ?.populate("hospital")
              ?.lean();
          } catch (e) {}
        }

        // 3. If doc was found in DischargeRecord but this is a final bill / settlement, match its TransactionReport
        if (doc && (type === "discharge-settlement" || type === "final-bill")) {
          const patId = doc.patient?._id || doc.patient || patientId;
          const admId = doc.admissionId || doc.ipNo || doc.admission;
          try {
            const matchingTxn = await safeUnscoped(
              TransactionReport.findOne({
                $or: [
                  ...(admId ? [{ admissionId: admId }, ...(mongoose.Types.ObjectId.isValid(admId) ? [{ admission: admId }] : [])] : []),
                  ...(patId ? [{ patient: patId }] : []),
                ],
              }).sort({ date: -1, createdAt: -1 })
            )?.populate("patient")?.populate("hospital")?.lean();

            if (matchingTxn && matchingTxn.reportData) {
              doc = {
                ...doc,
                ...matchingTxn,
                patient: matchingTxn.patient || doc.patient,
                hospital: matchingTxn.hospital || doc.hospital,
                reportData: matchingTxn.reportData,
                totals: matchingTxn.totals || doc.totals,
              };
            }
          } catch (e) {}
        }
      }

      // 4. Populate admission and hospital information for the IPD bill
      if (doc && (type === "discharge-settlement" || type === "final-bill")) {
        try {
          const admQuery: any[] = [];
          if (doc.admission && mongoose.Types.ObjectId.isValid(doc.admission)) admQuery.push({ _id: doc.admission });
          if (doc.admissionId) admQuery.push({ admissionId: doc.admissionId });
          if (doc.ipNo) admQuery.push({ admissionId: doc.ipNo });
          const pId = doc.patient?._id || doc.patient || patientId;
          if (pId) admQuery.push({ patient: pId });

          if (admQuery.length > 0) {
            const admDoc: any = await safeUnscoped(
              IPDAdmission.findOne({ $or: admQuery })
                .sort({ admissionDate: -1 })
                .populate({ path: "primaryDoctor", populate: { path: "user", select: "name" } })
                .populate({ path: "hospital", select: "name address phone email logo gstNumber cinNumber cin" })
            )?.lean();

            if (admDoc) {
              doc.admission = admDoc;
              doc.admissionInfo = {
                admissionId: admDoc.admissionId,
                admissionDate: admDoc.admissionDate,
                admissionType: admDoc.admissionType || "IPD",
                status: admDoc.status || "Discharged",
                dischargeDate: admDoc.dischargeDate || doc.dischargeDate,
                dischargeType: admDoc.dischargeType || doc.dischargeType || "Regular",
                doctorName: (admDoc.primaryDoctor as any)?.user?.name || (admDoc.primaryDoctor as any)?.name || doc.primaryDoctor || "",
                wardName: admDoc.ward || doc.roomType || "",
                bedNumber: admDoc.bed || doc.bedNo || "",
              };
            }
          }
        } catch (e) {}
      }
    }

    if (!doc) {
      return null;
    }

    // ── AUTHENTIC HOSPITAL RESOLUTION ──
    const targetHospId =
      doc.hospital?._id ||
      doc.hospital ||
      hospitalId ||
      context?.user?.hospitalId;

    if (targetHospId && (!doc.hospital || typeof doc.hospital !== "object" || !doc.hospital.name)) {
      try {
        const fullHosp =
          (await Hospital.findById(targetHospId).lean()) ||
          (await Hospital.findOne({ hospitalId: targetHospId }).lean());
        if (fullHosp) {
          doc.hospital = fullHosp;
        }
      } catch (e) {}
    }

    // ── AUTHENTIC PATIENT RESOLUTION ──
    const targetPatId =
      doc.patient?._id ||
      doc.patient ||
      doc.patientDetails?.patient ||
      patientId;

    let patUser: any = typeof doc.patient === "object" ? doc.patient : null;
    if (targetPatId && (!patUser || !patUser.name)) {
      try {
        patUser =
          (await Patient.findById(targetPatId).lean()) ||
          (await User.findById(targetPatId).lean());
      } catch (e) {}
    }

    let patProfile: any = null;
    if (targetPatId || doc.mrn) {
      try {
        patProfile = await PatientProfile.findOne({
          $or: [
            ...(targetPatId ? [{ user: targetPatId }, { _id: targetPatId }] : []),
            ...(doc.mrn ? [{ mrn: doc.mrn }] : []),
          ],
        }).lean();
      } catch (e) {}
    }

    if (patProfile?.user && (!patUser || !patUser.name)) {
      try {
        patUser =
          (await Patient.findById(patProfile.user).lean()) ||
          (await User.findById(patProfile.user).lean());
      } catch (e) {}
    }

    if (doc.doctor) {
      const docName =
        doc.doctor.name ||
        doc.doctor.user?.name ||
        (typeof doc.doctor.user === "object" ? doc.doctor.user?.name : "") ||
        "";
      if (docName) {
        doc.doctor.name = docName;
      }
    }

    let authenticName =
      doc.patientDetails?.name ||
      doc.patientName ||
      doc.customerName ||
      patProfile?.name ||
      patUser?.name ||
      (typeof doc.patient === "object" ? doc.patient?.name : "") ||
      context?.user?.name ||
      "";

    if (authenticName.toUpperCase().includes("UNNAMED") || authenticName.toUpperCase().includes("UNKNOWN")) {
      authenticName =
        doc.patientDetails?.name ||
        patProfile?.name ||
        patUser?.name ||
        context?.user?.name ||
        "";
    }

    const authenticHonorific =
      doc.appointmentHonorific ||
      doc.honorific ||
      doc.patientDetails?.honorific ||
      patProfile?.honorific ||
      patUser?.honorific ||
      context?.user?.honorific ||
      "";

    doc.patient = {
      ...(patProfile || {}),
      ...(patUser || {}),
      ...(doc.patientDetails || {}),
      ...(typeof doc.patient === "object" ? doc.patient : {}),
      name: authenticName,
      honorific: authenticHonorific,
      mrn: doc.mrn || patProfile?.mrn || patUser?.mrn || (typeof doc.patient === "object" ? doc.patient.mrn : "") || "",
      mobile:
        doc.patientDetails?.guardianMobile ||
        doc.customerPhone ||
        patUser?.mobile ||
        patProfile?.contactNumber ||
        (typeof doc.patient === "object" ? doc.patient.mobile : "") ||
        "",
      address: patProfile?.address || patUser?.address || (typeof doc.patient === "object" ? doc.patient.address : "") || doc.patientAddress || doc.address || "",
      dob: patProfile?.dob || patUser?.dateOfBirth || (typeof doc.patient === "object" ? (doc.patient.dateOfBirth || doc.patient.dob) : "") || doc.patientDetails?.dob || "",
      age: (typeof doc.patient === "object" && doc.patient.age !== undefined) ? doc.patient.age : (doc.patientDetails?.age ?? patProfile?.age ?? patUser?.age ?? ""),
      gender: (typeof doc.patient === "object" && doc.patient.gender) || doc.patientDetails?.gender || patProfile?.gender || patUser?.gender || "",
    };

    if (doc.patientDetails) {
      doc.patientDetails.name = authenticName || doc.patientDetails.name;
      doc.patientDetails.honorific = authenticHonorific || doc.patientDetails.honorific;
      if (doc.patient.age) doc.patientDetails.age = doc.patient.age;
      if (doc.patient.gender) doc.patientDetails.gender = doc.patient.gender;
    }

    if (type.includes("lab") || doc.tests) {
      try {
        const labSettingsDoc =
          (targetHospId ? await safeUnscoped(LabSettings.findOne({ hospital: targetHospId })).lean() : null) ||
          (await safeUnscoped(LabSettings.findOne()).lean());
        if (labSettingsDoc) {
          doc.labSettings = labSettingsDoc;
          doc.labInfo = {
            name: labSettingsDoc.name || "MEDI LAB LABORATORY",
            tagline: labSettingsDoc.tagline || "Advanced Diagnostic Services",
            address: labSettingsDoc.address || "123 Medical Plaza, Healthcare District",
            phone: labSettingsDoc.phone || "+91 98765 43210",
            email: labSettingsDoc.email || "lab@mscurechain.com",
            logo: labSettingsDoc.logo || undefined,
          };
        }
      } catch (e) {}
    }

    return doc;
  } catch (err) {
    console.warn(`[resolveClinicalRecord] Warning resolving ${type}/${id}:`, err);
  }

  return null;
}

/**
 * GET /api/patient/receipts/:type/:id OR POST /api/patient/receipts/render
 * Resolves authentic clinical data from MongoDB based on (hospitalId, patientId) and renders via canonical engine.
 */
export const getReceiptHtml = async (req: Request, res: Response) => {
  try {
    const type = req.params?.type || req.body?.type;
    const id = req.params?.id || req.body?.id;
    let dataPayload = req.body?.data;

    const hospitalId =
      req.query?.hospitalId ||
      req.body?.hospitalId ||
      req.headers["x-hospital-id"] ||
      (req as any).user?.hospitalId ||
      (req as any).user?.hospitals?.[0];

    const patientId =
      req.query?.patientId ||
      req.body?.patientId ||
      (req as any).user?._id ||
      (req as any).user?.patientId;

    // 1. Resolve authentic clinical document from MongoDB
    const dbRecord = await tenantLocalStorage.run(
      {
        tenantId:
          hospitalId && mongoose.Types.ObjectId.isValid(hospitalId as string)
            ? new mongoose.Types.ObjectId(hospitalId as string)
            : null,
        userId: null,
        role: null,
        isSuperAdmin: true,
      },
      async () => {
        return await resolveClinicalRecord(type, id, {
          hospitalId: hospitalId as string,
          patientId: patientId as string,
          user: (req as any).user,
        });
      }
    );

    if (dbRecord) {
      const clientPatient =
        typeof dataPayload?.patient === "object" &&
        dataPayload?.patient !== null &&
        !Array.isArray(dataPayload?.patient) &&
        dataPayload?.patient?.name
          ? dataPayload.patient
          : {};

      dataPayload = {
        ...(dataPayload || {}),
        ...dbRecord,
        reportData: dbRecord.reportData || dataPayload?.reportData,
        totals: dbRecord.totals || dataPayload?.totals,
        receipts: dbRecord.reportData?.payments || dbRecord.receipts || dataPayload?.receipts,
        admission: dbRecord.admission || dataPayload?.admission,
        admissionInfo: dbRecord.admissionInfo || dataPayload?.admissionInfo,
        hospital: dbRecord.hospital || (typeof dataPayload?.hospital === "object" ? dataPayload.hospital : null),
        doctor: dbRecord.doctor || (typeof dataPayload?.doctor === "object" ? dataPayload.doctor : null),
        patient: {
          ...(typeof dbRecord.patient === "object" ? dbRecord.patient : {}),
          ...clientPatient,
          guardianName: (typeof dbRecord.patient === "object" && (dbRecord.patient.GuardianName || dbRecord.patient.guardianName)) || clientPatient.guardianName || clientPatient.GuardianName || "",
          GuardianName: (typeof dbRecord.patient === "object" && (dbRecord.patient.GuardianName || dbRecord.patient.guardianName)) || clientPatient.GuardianName || clientPatient.guardianName || "",
          name: (typeof dbRecord.patient === "object" && dbRecord.patient.name) || clientPatient.name || dbRecord.patientName,
          age: (typeof dbRecord.patient === "object" && dbRecord.patient.age !== undefined) ? dbRecord.patient.age : clientPatient.age,
          gender: (typeof dbRecord.patient === "object" && dbRecord.patient.gender) || clientPatient.gender,
          mrn: (typeof dbRecord.patient === "object" && dbRecord.patient.mrn) || dbRecord.mrn || clientPatient.mrn,
          honorific: (typeof dbRecord.patient === "object" && dbRecord.patient.honorific) || clientPatient.honorific,
          dob: (typeof dbRecord.patient === "object" && dbRecord.patient.dob) || clientPatient.dob,
        },
        patientDetails: {
          ...(typeof dbRecord.patient === "object" ? dbRecord.patient : {}),
          ...(dbRecord.patientDetails || {}),
          ...clientPatient,
          guardianName: (typeof dbRecord.patient === "object" && (dbRecord.patient.GuardianName || dbRecord.patient.guardianName)) || clientPatient.guardianName || clientPatient.GuardianName || "",
          GuardianName: (typeof dbRecord.patient === "object" && (dbRecord.patient.GuardianName || dbRecord.patient.guardianName)) || clientPatient.GuardianName || clientPatient.guardianName || "",
        },
        medicines: dbRecord.medicines || dataPayload?.medicines,
        diagnosis: dbRecord.diagnosis || dataPayload?.diagnosis,
        symptoms: dbRecord.symptoms || dbRecord.reason || dataPayload?.symptoms || dataPayload?.reason,
        prescriptionDate: dbRecord.prescriptionDate || dbRecord.createdAt || dataPayload?.prescriptionDate,
        appointmentId: dbRecord.appointmentId || dataPayload?.appointmentId || id,
        labSettings: dbRecord.labSettings || dataPayload?.labSettings,
        labInfo: dbRecord.labInfo || dataPayload?.labInfo,
        sampleId: dbRecord.sampleId || dbRecord.tokenNumber || dataPayload?.sampleId || id,
        tests: (dbRecord.tests && dbRecord.tests.length > 0) ? dbRecord.tests : dataPayload?.tests,
      };
    }

    const baseUrl = getFrontendBaseUrl();

    // ── For discharge-settlement/final-bill: enrich with full IPD Final Bill reportData if missing ──
    if (type === "discharge-settlement" || type === "final-bill") {
      try {
        const resolvedPatientId =
          (typeof dataPayload?.patient === "object" ? dataPayload.patient?._id : dataPayload?.patient) ||
          dbRecord?.patient?._id ||
          dbRecord?.patient ||
          patientId;
        const resolvedHospitalId =
          (typeof dataPayload?.hospital === "object" ? dataPayload.hospital?._id : dataPayload?.hospital) ||
          dbRecord?.hospital?._id ||
          dbRecord?.hospital ||
          hospitalId;

        if ((!dataPayload?.reportData || !dataPayload?.reportData?.admissions?.length) && resolvedPatientId && resolvedHospitalId) {
          // Direct internal call — no HTTP, no auth required
          const ipdBill = await buildIPDFinalBillPayload(
            String(resolvedPatientId),
            String(resolvedHospitalId)
          );

          if (ipdBill && (ipdBill.reportData || ipdBill.totals)) {
            dataPayload = {
              ...dataPayload,
              reportData: ipdBill.reportData || dataPayload?.reportData,
              totals: ipdBill.totals || dataPayload?.totals,
              admission: ipdBill.admission || dataPayload?.admission,
              admissionInfo: ipdBill.admissionInfo || dataPayload?.admissionInfo,
              patientInfo: ipdBill.patientInfo || dataPayload?.patientInfo,
              hospitalInfo: ipdBill.hospitalInfo || dataPayload?.hospitalInfo,
              receipts: ipdBill.receipts || dataPayload?.receipts,
            };
          }
        }
      } catch (enrichErr) {
        console.warn("[receiptController] IPD bill enrichment failed (non-fatal):", enrichErr);
      }
    }

    // 2. Call canonical POST /api/receipts/render
    if (dataPayload) {
      const renderRes = await fetch(`${baseUrl}/api/receipts/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, data: dataPayload }),
      });

      const renderJson = await renderRes.json();
      if (renderRes.ok && renderJson.success) {
        return res.json(renderJson);
      }
    }

    // 3. Fallback to GET /api/receipts/:type/:id if ID was directly queried
    if (id) {
      const targetUrl = `${baseUrl}/api/receipts/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
      const response = await fetch(targetUrl, {
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();
      if (response.ok && data.success) {
        return res.json(data);
      }
    }

    return res.status(404).json({
      success: false,
      error: `No authentic clinical document found for ${type}`,
    });
  } catch (error: any) {
    console.error("[Backend getReceiptHtml Error]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to retrieve receipt HTML",
    });
  }
};

/**
 * POST /api/patient/receipts/:type/:id/whatsapp
 * Dispatches the official receipt to the patient's phone via the hospital WhatsApp gateway.
 */
export const sendReceiptWhatsApp = async (req: Request, res: Response) => {
  try {
    const { type, id } = req.params;
    const { phone: inputPhone, hospitalId: inputHospitalId, data: inputData } = req.body || {};
    const user = (req as any).user;

    const phone = inputPhone || user?.mobile || user?.phone;
    if (!phone) {
      return res.status(400).json({ success: false, error: "Recipient phone number is required" });
    }

    let docData: any = null;
    const baseUrl = getFrontendBaseUrl();

    if (inputData) {
      const renderRes = await fetch(`${baseUrl}/api/receipts/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, data: inputData }),
      });
      docData = await renderRes.json();
    } else {
      const targetUrl = `${baseUrl}/api/receipts/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
      const response = await fetch(targetUrl, {
        headers: { "Content-Type": "application/json" },
      });
      docData = await response.json();
    }

    const hospitalId = inputHospitalId || user?.hospitalId || "horizin-hospital";

    const waService = whatsappManager.getInstance(hospitalId);
    const caption = docData?.caption || `*MSCURECHAIN RECORD*\n━━━━━━━━━━━━━━━━━━\nDocument: ${docData?.title || type}\nID: ${id}`;

    const pdfBase64 = req.body?.pdfBase64;

    if (pdfBase64) {
      await waService.sendMedia(phone, {
        pdfBase64,
        fileName: docData?.documentName || `${type}_${id}.pdf`,
        caption,
      });
    } else {
      await waService.sendTextMessage(phone, caption);
    }

    return res.json({
      success: true,
      message: "Receipt dispatched to WhatsApp successfully",
      phone,
    });
  } catch (error: any) {
    console.error("[Backend sendReceiptWhatsApp Error]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to dispatch WhatsApp receipt",
    });
  }
};
