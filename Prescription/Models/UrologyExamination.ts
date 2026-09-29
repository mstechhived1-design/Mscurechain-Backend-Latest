import mongoose, { Schema, Document } from "mongoose";

export interface IUrologyExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  symptoms: string[];

  ipss: {
    score: number;
    category: "Mild" | "Moderate" | "Severe" | "";
  };

  urine: {
    pusCells: number;
    rbc:      number;
    protein:  string; // Nil, Trace, 1+, 2+, 3+
    nitrite:  boolean;
  };

  renal: {
    creatinine: number;
    urea:       number;
  };

  stone: {
    size:     number; // mm
    location: "Kidney" | "Ureter" | "Bladder" | "None" | "";
  };

  prostate: {
    size:        string; // Gr I, II, III etc
    consistency: string; // Soft, Firm, Hard
    nodules:     boolean;
  };

  pvr: number; // ml

  catheter: {
    present:  boolean;
    type:     string;
    duration: string;
    reason:   string;
  };

  diagnosis: string;
  notes?:    string;
  createdAt: Date;
  updatedAt: Date;
}

const UrologyExaminationSchema: Schema = new Schema(
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

    symptoms: [{ type: String }],

    ipss: {
      score:    { type: Number, default: 0 },
      category: { type: String, enum: ["Mild", "Moderate", "Severe", ""], default: "" },
    },

    urine: {
      pusCells: { type: Number, default: 0 },
      rbc:      { type: Number, default: 0 },
      protein:  { type: String, default: "Nil" },
      nitrite:  { type: Boolean, default: false },
    },

    renal: {
      creatinine: { type: Number, required: [true, "Creatinine is mandatory"] },
      urea:       { type: Number, default: 0 },
    },

    stone: {
      size:     { type: Number, default: 0 },
      location: { type: String, enum: ["Kidney", "Ureter", "Bladder", "None", ""], default: "" },
    },

    prostate: {
      size:        { type: String, default: "" },
      consistency: { type: String, default: "" },
      nodules:     { type: Boolean, default: false },
    },

    pvr: { type: Number, default: 0 },

    catheter: {
      present:  { type: Boolean, default: false },
      type:     { type: String, default: "" },
      duration: { type: String, default: "" },
      reason:   { type: String, default: "" },
    },

    diagnosis: { type: String, required: [true, "Diagnosis is mandatory"] },
    notes:     { type: String },
  },
  { timestamps: true },
);

// Indices
UrologyExaminationSchema.index({ hospital: 1, createdAt: -1 });
UrologyExaminationSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
UrologyExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IUrologyExamination>(
  "UrologyExamination",
  UrologyExaminationSchema,
);
