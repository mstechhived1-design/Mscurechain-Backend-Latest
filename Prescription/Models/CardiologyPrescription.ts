import mongoose, { Schema, Document } from "mongoose";

export interface ICardiologyPrescription extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;

  // A. Vital Signs
  bpSystolic: number;
  bpDiastolic: number;
  heartRate: number;
  rhythm: string;

  // B. Cardiac Symptoms
  symptoms: string[];

  // C. Risk Factors
  riskFactors: string[];

  // D. ECG Findings
  ecgType: string;
  ecgLeads: string[];
  ecgNotes?: string;

  // E. Heart Sounds
  s1: string;
  s2: string;
  murmur: string;
  murmurType?: string;

  // F. Cardiac Risk Level
  riskLevel: "Low" | "Moderate" | "High";

  // G. Functional Status
  nyhaClass: string;

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CardiologyPrescriptionSchema: Schema = new Schema(
  {
    prescriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Prescription",
      required: true,
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    hospital: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },

    // A. Vital Signs
    bpSystolic: { 
      type: Number, 
      required: true,},
    bpDiastolic: { 
      type: Number, 
      required: true,},
    heartRate: { 
      type: Number, 
      required: true,},
    rhythm: {
      type: String,
      required: true,
      enum: ["Regular", "Irregular", "Atrial Fibrillation", "Bradycardia", "Tachycardia"]
    },

    // B. Cardiac Symptoms
    symptoms: {
      type: [String],
      enum: ["Chest Pain", "Shortness of Breath", "Palpitations", "Syncope", "Fatigue"]
    },

    // C. Risk Factors
    riskFactors: {
      type: [String],
      enum: ["Hypertension", "Diabetes", "Smoking", "Alcohol", "Family History"]
    },

    // D. ECG Findings
    ecgType: {
      type: String,
      enum: ["Normal", "ST Elevation", "ST Depression", "T Wave Inversion", "Arrhythmia", ""],
      default: "Normal"
    },
    ecgLeads: {
      type: [String],
      enum: ["V1–V6", "II, III, aVF", "I, aVL"]
    },
    ecgNotes: { type: String },

    // E. Heart Sounds
    s1: { type: String, enum: ["Normal", "Loud", "Soft", ""], default: "Normal" },
    s2: { type: String, enum: ["Normal", "Loud", "Soft", ""], default: "Normal" },
    murmur: { type: String, enum: ["None", "Present", ""], default: "None" },
    murmurType: { type: String, enum: ["Systolic", "Diastolic", ""], default: "" },

    // F. Cardiac Risk Level
    riskLevel: {
      type: String,
      required: true,
      enum: ["Low", "Moderate", "High"]
    },

    // G. Functional Status
    nyhaClass: {
      type: String,
      enum: ["I", "II", "III", "IV", ""]
    },

    notes: { type: String },
  },
  { timestamps: true },
);

CardiologyPrescriptionSchema.index({ hospital: 1, createdAt: -1 });
CardiologyPrescriptionSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
CardiologyPrescriptionSchema.plugin(multiTenancyPlugin);

export default mongoose.model<ICardiologyPrescription>(
  "CardiologyPrescription",
  CardiologyPrescriptionSchema,
);
