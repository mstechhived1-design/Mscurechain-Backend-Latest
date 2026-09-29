import mongoose, { Schema, Document } from "mongoose";

export interface IPendingDischarge extends Document {
  patientName: string;
  age?: string;
  gender: string;
  phone?: string;
  address?: string;
  ipNo?: string;
  mrn: string;
  roomNo?: string;
  roomType?: string;
  bedNo?: string;
  admissionType?: string;
  dischargeType?: string;
  admissionDate?: Date;
  dischargeDate?: Date;
  department?: string;
  consultants: string[];
  reasonForAdmission?: string;
  provisionalDiagnosis?: string;
  diagnosis?: string;
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
  treatmentGiven?: string;
  surgicalProcedures?: string;
  surgeryNotes?: string;
  investigationsPerformed?: string;
  hospitalCourse?: string;
  conditionAtDischarge?: string;
  medicationsPrescribed?: string;
  adviceAtDischarge?: string;
  activityRestrictions?: string;
  followUpInstructions?: string;
  hospital: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  preparedBy?: mongoose.Types.ObjectId;
  status: string;
  queuePosition?: number;
  admissionId: string;
  primaryDoctor?: string;
  suggestedDoctorName?: string;
  specialistType?: string;
  ipdHistory?: any[];
  hospitalName?: string;
  hospitalRegNo?: string;
  documentId?: string;
  patientTitle?: string;
  dob?: Date;
  email?: string;
  nationality?: string;
  bloodGroup?: string;
  maritalStatus?: string;
  govtId?: string;
  attendantName?: string;
  attendantRelationship?: string;
  attendantPhone?: string;
  icdCode?: string;
  dietInstructions?: string;
  warningSigns?: string;
  allergyHistory?: string;
  followUpDate?: Date;
  totalBillAmount?: number;
  paymentMode?: string;
  insuranceName?: string;
  advanceAmount?: number;
  balance?: number;
  createdAt: Date;
  updatedAt: Date;
}

const PendingDischargeSchema: Schema = new Schema(
  {
    patientName: { type: String, required: true },
    age: { type: String },
    gender: { type: String },
    phone: { type: String },
    address: { type: String },
    ipNo: { type: String },
    mrn: { type: String, required: true },
    roomNo: { type: String },
    roomType: { type: String },
    bedNo: { type: String },
    admissionType: { type: String },
    dischargeType: { type: String },
    admissionDate: { type: Date },
    dischargeDate: { type: Date },
    department: { type: String },
    consultants: [{ type: String }],
    reasonForAdmission: { type: String },
    provisionalDiagnosis: { type: String },
    diagnosis: { type: String },
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
    treatmentGiven: { type: String },
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
      enum: ["REQUESTED", "PREPARED_BY_NURSE", "COMPLETED"],
      default: "REQUESTED",
    },
    queuePosition: { type: Number },
    admissionId: { type: String, required: true },
    primaryDoctor: { type: String },
    suggestedDoctorName: { type: String },
    hospitalName: { type: String },
    hospitalRegNo: { type: String },
    documentId: { type: String },
    patientTitle: { type: String },
    dob: { type: Date },
    email: { type: String },
    nationality: { type: String },
    bloodGroup: { type: String },
    maritalStatus: { type: String },
    govtId: { type: String },
    attendantName: { type: String },
    attendantRelationship: { type: String },
    attendantPhone: { type: String },
    icdCode: { type: String },
    dietInstructions: { type: String },
    warningSigns: { type: String },
    allergyHistory: { type: String },
    followUpDate: { type: Date },
    totalBillAmount: { type: Number },
    paymentMode: { type: String },
    insuranceName: { type: String },
    advanceAmount: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    specialistType: { type: String },
    ipdHistory: { type: Array },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
PendingDischargeSchema.plugin(multiTenancyPlugin);

// Performance indexes
PendingDischargeSchema.index({ hospital: 1, createdAt: -1 });
PendingDischargeSchema.index({ mrn: 1 });
PendingDischargeSchema.index({ admissionId: 1, hospital: 1 }, { unique: true });

export default mongoose.model<IPendingDischarge>(
  "PendingDischarge",
  PendingDischargeSchema,
);
