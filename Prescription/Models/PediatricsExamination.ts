import mongoose, { Schema, Document } from "mongoose";

export interface IPediatricsExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;

  // A. Basic Child Profile
  weight?: number;          // kg  — OPTIONAL
  height?: number;          // cm
  headCircumference?: number; // cm — only for < 5 yrs

  // B. Vitals
  temperature?: number;    // °F
  heartRate?: number;      // bpm
  respRate?: number;       // breaths/min

  // C. Growth Assessment
  growth: {
    weightForAge?: "Normal" | "Underweight" | "Overweight";
    heightForAge?: "Normal" | "Stunted";
  };

  // D. Developmental Milestones
  milestones?: "Normal" | "Delayed" | "Borderline";
  milestoneNotes?: string;

  // E. Immunization
  immunizationStatus?: "Up to date" | "Partially immunized" | "Not immunized";
  dueVaccines?: string[];

  // F. Symptoms
  symptoms?: (
    | "Fever"
    | "Cough"
    | "Vomiting"
    | "Diarrhea"
    | "Poor Feeding"
    | "Lethargy"
    | "Seizures"
  )[];

  // G. Red Flag Signs
  redFlags?: (
    | "Persistent Fever"
    | "Poor Feeding"
    | "Respiratory Distress"
    | "Convulsions"
  )[];

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PediatricsExaminationSchema: Schema = new Schema(
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

    // A. Child Profile
    weight: {
      type: Number,
      required: [true, "Weight is required for pediatric prescription"],
    },
    height: {
      type: Number,
    },
    headCircumference: {
      type: Number,
    },

    // B. Vitals
    temperature: {
      type: Number,
    },
    heartRate: {
      type: Number,
    },
    respRate: {
      type: Number,
    },

    // C. Growth Assessment
    growth: {
      weightForAge: {
        type: String,
        enum: ["Normal", "Underweight", "Overweight", ""],
        default: ""
      },
      heightForAge: {
        type: String,
        enum: ["Normal", "Stunted", ""],
        default: ""
      },
    },

    // D. Developmental Milestones
    milestones: {
      type: String,
      enum: ["Normal", "Delayed", "Borderline", ""],
      default: ""
    },
    milestoneNotes: { type: String },

    // E. Immunization
    immunizationStatus: {
      type: String,
      enum: ["Up to date", "Partially immunized", "Not immunized", ""],
      default: ""
    },
    dueVaccines: {
      type: [String],
      enum: [
        "BCG", "OPV", "DPT", "Hib", "PCV", "Rotavirus",
        "IPV", "Hepatitis B", "MMR", "Varicella",
        "Typhoid", "Hepatitis A", "Meningococcal",
      ],
      set: (v: string[]) => (Array.isArray(v) ? v.filter((x) => x && x !== "") : v),
    },

    // F. Symptoms
    symptoms: {
      type: [String],
      enum: [
        "Fever", "Cough", "Vomiting", "Diarrhea",
        "Poor Feeding", "Lethargy", "Seizures",
      ],
      set: (v: string[]) => (Array.isArray(v) ? v.filter((x) => x && x !== "") : v),
    },

    // G. Red Flags
    redFlags: {
      type: [String],
      enum: [
        "Persistent Fever", "Poor Feeding",
        "Respiratory Distress", "Convulsions",
      ],
      set: (v: string[]) => (Array.isArray(v) ? v.filter((x) => x && x !== "") : v),
    },

    notes: { type: String },
  },
  { timestamps: true },
);

PediatricsExaminationSchema.index({ hospital: 1, createdAt: -1 });
PediatricsExaminationSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
PediatricsExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IPediatricsExamination>(
  "PediatricsExamination",
  PediatricsExaminationSchema,
);
