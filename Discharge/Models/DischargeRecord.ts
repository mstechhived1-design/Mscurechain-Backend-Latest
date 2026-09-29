import mongoose, { Schema, Document } from "mongoose";

export interface IDischargeRecord extends Document {
  patientName: string;
  age?: string;
  gender: string;
  phone?: string;
  address?: string;
  ipNo?: string;
  mrn: string;
  roomNo?: string;
  roomType?: string;
  bedNo?: string; // NEW
  admissionType?: string; // NEW (IPD/Emergency/ICU)
  dischargeType?: string; // NEW
  admissionDate?: Date;
  dischargeDate?: Date;
  department?: string;
  consultants: string[];
  reasonForAdmission?: string;
  provisionalDiagnosis?: string;
  diagnosis: string;
  chiefComplaints?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  vitals?: {
    height?: string;
    weight?: string;
    bloodPressure?: string;
    temperature?: string;
    pulse?: string;
    spO2?: string;
    sugar?: string;
  };
  generalAppearance?: string;
  treatmentGiven: string;
  surgicalProcedures?: string;
  surgeryNotes?: string;
  investigationsPerformed?: string;
  hospitalCourse?: string;
  conditionAtDischarge: string;
  medicationsPrescribed?: string;
  adviceAtDischarge?: string;
  activityRestrictions?: string;
  followUpInstructions?: string;
  hospital: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  preparedBy?: mongoose.Types.ObjectId;
  status?: string;
  queuePosition?: number;
  admissionId?: string;
  primaryDoctor?: string;
  suggestedDoctorName?: string;
  specialistType?: string; // NEW
  ipdHistory?: any[]; // NEW
  hospitalName?: string;
  hospitalAddress?: string; // NEW
  hospitalState?: string; // NEW
  hospitalPhone?: string; // NEW
  hospitalLogo?: string; // NEW
  hospitalRegNo?: string; // NEW
  documentId?: string; // NEW (Unique Summary Number)
  patientTitle?: string;
  dob?: Date; // NEW
  email?: string; // NEW
  nationality?: string; // NEW
  bloodGroup?: string; // NEW
  maritalStatus?: string; // NEW
  govtId?: string; // NEW
  attendantName?: string; // NEW
  attendantRelationship?: string; // NEW
  attendantPhone?: string; // NEW
  icdCode?: string; // NEW
  dietInstructions?: string; // NEW
  warningSigns?: string; // NEW
  allergyHistory?: string; // NEW
  followUpDate?: Date; // NEW
  followUpRemindersSent?: number; // NEW
  totalBillAmount?: number; // NEW
  paymentMode?: string; // NEW
  insuranceName?: string; // NEW
  bedChargesTotal?: number; // Granular Breakdown
  extraChargesTotal?: number; // Granular Breakdown
  discountAmount?: number; // Granular Breakdown
  // NABH Quality Indicators
  paymentSettledAt?: Date;
  dischargeAdviceAt?: Date;
  advanceAmount?: number; // Initial deposit
  remainingAmount?: number; // Total Bill - Advance (NEW)
  totalPaidAmount?: number; // Advance + Remaining (NEW)
  balance?: number; // Final settlement amount
  transactionId?: string;
  receiptNumber?: string;
  infectionFlags?: {
    hasSSI: boolean;
    hasUTI: boolean;
    hasVAP: boolean;
    hasCLABSI: boolean;
  };
  hasFall?: boolean;
  hasPressureSore?: boolean;
  isReadmission?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DischargeRecordSchema: Schema = new Schema(
  {
    patientName: { type: String, required: true },
    age: { type: String },
    gender: { type: String }, // Not required for pending status
    phone: { type: String },
    address: { type: String },
    ipNo: { type: String },
    mrn: { type: String, required: true },
    roomNo: { type: String },
    roomType: { type: String },
    bedNo: { type: String }, // NEW
    admissionType: { type: String }, // NEW
    dischargeType: { type: String }, // NEW
    admissionDate: { type: Date },
    dischargeDate: { type: Date },
    department: { type: String },
    consultants: [{ type: String }],
    reasonForAdmission: { type: String },
    provisionalDiagnosis: { type: String },
    diagnosis: { type: String }, // Not required for pending status
    chiefComplaints: { type: String },
    historyOfPresentIllness: { type: String },
    pastMedicalHistory: { type: String },
    vitals: {
      height: { type: String },
      weight: { type: String },
      bloodPressure: { type: String },
      temperature: { type: String },
      pulse: { type: String },
      spO2: { type: String },
      sugar: { type: String },
    },
    generalAppearance: { type: String },
    treatmentGiven: { type: String }, // Not required for pending status
    surgicalProcedures: { type: String },
    surgeryNotes: { type: String },
    investigationsPerformed: { type: String },
    hospitalCourse: { type: String },
    conditionAtDischarge: { type: String, default: "Improved" },
    medicationsPrescribed: { type: String },
    adviceAtDischarge: { type: String },
    activityRestrictions: { type: String },
    followUpInstructions: { type: String },
    hospital: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    preparedBy: { type: Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["pending", "in-progress", "completed"],
      default: "completed",
    },
    queuePosition: { type: Number },
    admissionId: { type: String },
    primaryDoctor: { type: String },
    suggestedDoctorName: { type: String },
    hospitalName: { type: String },
    hospitalAddress: { type: String }, // NEW
    hospitalState: { type: String }, // NEW
    hospitalPhone: { type: String }, // NEW
    hospitalLogo: { type: String }, // NEW
    hospitalRegNo: { type: String }, // NEW
    documentId: { type: String }, // NEW
    patientTitle: { type: String },
    dob: { type: Date }, // NEW
    email: { type: String }, // NEW
    nationality: { type: String }, // NEW
    bloodGroup: { type: String }, // NEW
    maritalStatus: { type: String }, // NEW
    govtId: { type: String }, // NEW
    attendantName: { type: String }, // NEW
    attendantRelationship: { type: String }, // NEW
    attendantPhone: { type: String }, // NEW
    icdCode: { type: String }, // NEW
    dietInstructions: { type: String }, // NEW
    warningSigns: { type: String }, // NEW
    allergyHistory: { type: String }, // NEW
    followUpDate: { type: Date }, // NEW
    followUpRemindersSent: { type: Number, default: 0 }, // NEW - For tracking notifications
    totalBillAmount: { type: Number }, // NEW
    paymentMode: { type: String }, // NEW
    insuranceName: { type: String }, // NEW
    bedChargesTotal: { type: Number, default: 0 },
    extraChargesTotal: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    specialistType: { type: String }, // NEW
    ipdHistory: { type: Array }, // NEW
    // NABH Quality Indicators
    paymentSettledAt: { type: Date },
    dischargeAdviceAt: { type: Date },
    advanceAmount: { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 }, // NEW
    totalPaidAmount: { type: Number, default: 0 }, // NEW
    balance: { type: Number, default: 0 },
    transactionId: { type: String },
    receiptNumber: { type: String },
    infectionFlags: {
      hasSSI: { type: Boolean, default: false },
      hasUTI: { type: Boolean, default: false },
      hasVAP: { type: Boolean, default: false },
      hasCLABSI: { type: Boolean, default: false },
    },
    hasFall: { type: Boolean, default: false },
    hasPressureSore: { type: Boolean, default: false },
    isReadmission: { type: Boolean, default: false },
    isEdited: { type: Boolean, default: false },
    editReason: { type: String },
    editedAt: { type: Date },
    editedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// 🛡️ Pre-save ID Generation for Final Settlement
DischargeRecordSchema.pre("save", async function (next) {
  if (this.hospital && this.status === "completed" && (!this.transactionId || !this.receiptNumber)) {
    try {
      const Hospital = mongoose.model("Hospital");
      const hospital = await Hospital.findById(this.hospital).select("name");
      const hospitalName = hospital?.name || "HOSPITAL";

      if (!this.transactionId) {
        const { generateTransactionId } = await import("../../utils/idGenerator.js");
        this.transactionId = await generateTransactionId(this.hospital, hospitalName, "IPD");
      }

      if (!this.receiptNumber) {
        const { generateReceiptNumber } = await import("../../utils/idGenerator.js");
        this.receiptNumber = await generateReceiptNumber(this.hospital);
      }
    } catch (err) {
      console.error("Error generating IDs for DischargeRecord:", err);
    }
  }
  next();
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
DischargeRecordSchema.plugin(multiTenancyPlugin);

// Performance indexes
DischargeRecordSchema.index({ hospital: 1, createdAt: -1 });
DischargeRecordSchema.index({ hospital: 1, status: 1, followUpDate: 1 });
DischargeRecordSchema.index({ mrn: 1 });
DischargeRecordSchema.index({ phone: 1, dischargeDate: -1 }); // MISSION CRITICAL: Patient Dashboard lookups
DischargeRecordSchema.index({ patientName: "text", mrn: "text", ipNo: "text" });

export default mongoose.model<IDischargeRecord>(
  "DischargeRecord",
  DischargeRecordSchema,
);
