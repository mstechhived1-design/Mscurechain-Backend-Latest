import mongoose, { Schema, Document } from "mongoose";

export interface IDermatologyPrescription extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;

  // A. Lesion Details
  lesionType: string;
  lesionCount?: number;
  size?: string;

  // B. Location & Distribution
  location: string[];
  distribution?: string;

  // C. Appearance & Surface
  color: string[];
  surfaceChanges: string[];

  // D. Symptoms
  itchingSeverity: "None" | "Mild" | "Moderate" | "Severe";
  painSeverity: "None" | "Mild" | "Moderate" | "Severe";
  burning: boolean;

  // E. Duration & Progression
  duration?: string;
  onset?: "Acute" | "Chronic";
  progression?: "Improving" | "Worsening" | "Stable";

  // F. Provisional Diagnosis
  provisionalDiagnosis?: string;

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DermatologyPrescriptionSchema: Schema = new Schema(
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

    // A. Lesion Details
    lesionType: {
      type: String,
      required: true,
      enum: [
        "Macule",
        "Papule",
        "Plaque",
        "Vesicle",
        "Bulla",
        "Nodule",
        "Pustule",
        "",
      ],
      default: "",
    },
    lesionCount: { type: Number },
    size: { type: String },

    // B. Location & Distribution
    location: {
      type: [String],
      required: true,
      enum: [
        "Face",
        "Neck",
        "Chest",
        "Back",
        "Arms",
        "Legs",
        "Scalp",
        "Genital",
      ],
    },
    distribution: {
      type: String,
      enum: ["Localized", "Generalized", "Symmetrical", "Asymmetrical", "Sun-exposed", "Intertriginous", ""],
      default: ""
    },

    // C. Appearance & Surface
    color: {
      type: [String],
      enum: [
        "Erythematous",
        "Hyperpigmented",
        "Hypopigmented",
        "Skin-colored",
      ],
    },
    surfaceChanges: {
      type: [String],
      enum: ["Scaling", "Crusting", "Ulceration", "Oozing"],
    },

    // D. Symptoms
    itchingSeverity: {
      type: String,
      enum: ["None", "Mild", "Moderate", "Severe", ""],
      default: "None",
    },
    painSeverity: {
      type: String,
      enum: ["None", "Mild", "Moderate", "Severe", ""],
      default: "None",
    },
    burning: { type: Boolean, default: false },

    // E. Duration & Progression
    duration: { type: String },
    onset: { type: String, enum: ["Acute", "Chronic", ""], default: "" },
    progression: {
      type: String,
      enum: ["Improving", "Worsening", "Stable", ""],
      default: ""
    },

    // F. Provisional Diagnosis
    provisionalDiagnosis: { type: String },

    notes: { type: String },
  },
  { timestamps: true },
);

DermatologyPrescriptionSchema.index({ hospital: 1, createdAt: -1 });
DermatologyPrescriptionSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
DermatologyPrescriptionSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IDermatologyPrescription>(
  "DermatologyPrescription",
  DermatologyPrescriptionSchema,
);
