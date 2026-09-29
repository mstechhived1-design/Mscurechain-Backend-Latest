import mongoose, { Schema, Document } from "mongoose";

export interface IGeneralSurgery extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patient:      mongoose.Types.ObjectId;
  doctor:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  // A. Surgical Assessment
  surgeryType: "Elective" | "Emergency" | "Day Case" | "";
  procedurePlanned: string;
  indication: string;

  // B. Physical Examination
  physicalExam: {
    abdomen: string;
    thorax:  string;
    limbs:   string;
    others:  string;
  };

  // C. Vitals
  vitals: {
    bp:    string;
    hr:    number;
    respRate: number;
    temp:  number;
    spo2:  number;
  };

  // D. Systemic Review
  systemicReview: {
    cvs: string;
    rs:  string;
    cns: string;
    git: string;
  };

  // E. Pre-op Preparation
  preOpChecklist: {
    npoStatus: boolean;
    consentSigned: boolean;
    investigationsDone: boolean;
    bloodCrossMatched: boolean;
  };

  diagnosis: string;
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

const GeneralSurgerySchema: Schema = new Schema(
  {
    prescriptionId: { type: Schema.Types.ObjectId, ref: "Prescription",   required: true, index: true },
    patient:      { type: Schema.Types.ObjectId, ref: "Patient",        required: true, index: true },
    doctor:       { type: Schema.Types.ObjectId, ref: "DoctorProfile",  required: true },
    hospital:     { type: Schema.Types.ObjectId, ref: "Hospital",       required: true },

    // A. Surgical Assessment
    surgeryType: { type: String, enum: ["Elective", "Emergency", "Day Case", ""], default: "" },
    procedurePlanned: { type: String, default: "" },
    indication: { type: String, default: "" },

    // B. Physical Examination
    physicalExam: {
      abdomen: { type: String, default: "" },
      thorax:  { type: String, default: "" },
      limbs:   { type: String, default: "" },
      others:  { type: String, default: "" },
    },

    // C. Vitals
    vitals: {
      bp:    { type: String, default: "" },
      hr:    { type: Number },
      respRate: { type: Number },
      temp:  { type: Number },
      spo2:  { type: Number },
    },

    // D. Systemic Review
    systemicReview: {
      cvs: { type: String, default: "" },
      rs:  { type: String, default: "" },
      cns: { type: String, default: "" },
      git: { type: String, default: "" },
    },

    // E. Pre-op Preparation
    preOpChecklist: {
      npoStatus: { type: Boolean, default: false },
      consentSigned: { type: Boolean, default: false },
      investigationsDone: { type: Boolean, default: false },
      bloodCrossMatched: { type: Boolean, default: false },
    },

    diagnosis: { type: String, default: "" },
    notes: { type: String },
  },
  { timestamps: true },
);

GeneralSurgerySchema.index({ hospital: 1, createdAt: -1 });
GeneralSurgerySchema.index({ patient:  1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
GeneralSurgerySchema.plugin(multiTenancyPlugin);

export default mongoose.model<IGeneralSurgery>(
  "GeneralSurgery",
  GeneralSurgerySchema,
);
