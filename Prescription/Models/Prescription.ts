import mongoose, { Schema, Document } from "mongoose";

export interface IPrescription extends Document {
  appointment: mongoose.Types.ObjectId;
  patient: mongoose.Types.ObjectId;
  globalPatientId?: mongoose.Types.ObjectId;
  doctor: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  admission?: mongoose.Types.ObjectId;
  prescriptionDate: Date;
  diagnosis: string;
  chiefComplaints?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  familyHistory?: string;
  clinicalFindings?: string;
  assessment?: string;
  plan?: string;
  symptoms: string[];
  medicines: {
    name: string;
    genericName?: string;
    dosage: string;
    frequency: any;
    timing?: string;
    route?: string;
    duration: string;
    quantity?: string;
    instructions?: string;
  }[];
  advice: string;
  dietAdvice?: string[];
  suggestedTests?: string[];
  avoid?: string[];
  followUpDate?: Date;
  followUpRemindersSent: number;
  notes?: string;
  aiGenerated: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const PrescriptionSchema: Schema = new Schema(
  {
    appointment: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
    },
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    doctor: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    admission: { type: Schema.Types.ObjectId, ref: "IPDAdmission" },
    prescriptionDate: { type: Date, default: Date.now },
    diagnosis: { type: String, required: true },
    chiefComplaints: { type: String },
    historyOfPresentIllness: { type: String },
    pastMedicalHistory: { type: String },
    familyHistory: { type: String },
    clinicalFindings: { type: String },
    assessment: { type: String },
    plan: { type: String },
    symptoms: [{ type: String }],
    medicines: [
      {
        name: { type: String, required: true },
        genericName: { type: String },
        dosage: { type: String, required: true },
        frequency: { type: Schema.Types.Mixed, required: true },
        timing: { type: String },
        route: { type: String },
        duration: { type: String, required: true, default: 'As directed' },
        quantity: { type: String },
        instructions: { type: String },
      },
    ],
    advice: { type: String },
    dietAdvice: [{ type: String }],
    suggestedTests: [{ type: String }],
    avoid: [{ type: String }],
    followUpDate: { type: Date },
    followUpRemindersSent: { type: Number, default: 0 },
    notes: { type: String },

    aiGenerated: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

PrescriptionSchema.index({ doctor: 1, createdAt: -1 });
PrescriptionSchema.index({ patient: 1 });
PrescriptionSchema.index({ appointment: 1 });
PrescriptionSchema.index({ hospital: 1, followUpDate: 1 });
PrescriptionSchema.index({ globalPatientId: 1, hospital: 1 });
PrescriptionSchema.index({ globalPatientId: 1, createdAt: -1 });
PrescriptionSchema.index({ hospital: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
PrescriptionSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IPrescription>(
  "Prescription",
  PrescriptionSchema,
);
