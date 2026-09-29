import mongoose, { Schema, Document } from "mongoose";

export interface IGeneralSurgeryExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  // A. Symptoms
  symptoms: string[];

  // B. Abdominal Examination
  abdomen: {
    distention: "None" | "Mild" | "Severe";
    tenderness: "None" | "Epigastric" | "RUQ" | "RLQ" | "LLQ" | "Diffuse";
    guarding:   "None" | "Guarding" | "Rigidity";
    masses:     string;
    bowelSounds: "Normal" | "Hyperactive" | "Sluggish" | "Absent";
  };

  // C. Hernia Examination
  hernia: {
    present: boolean;
    site:    string;
    type:    "Reducible" | "Irreducible" | "Obstructed" | "Strangulated" | "N/A";
  };

  // D. Surgical Site (Post-op)
  surgicalSite?: {
    dressing:   "Clean" | "Soaked" | "N/A";
    infection:  boolean;
    discharge:  string;
  };

  // E. Diagnosis & Plan
  diagnosis: string;
  plan:      "Conservative" | "Surgical" | "Emergency Surgery";

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const GeneralSurgeryExaminationSchema: Schema = new Schema(
  {
    prescriptionId: { type: Schema.Types.ObjectId, ref: "Prescription",   required: true, index: true },
    patientId:      { type: Schema.Types.ObjectId, ref: "Patient",        required: true, index: true },
    doctorId:       { type: Schema.Types.ObjectId, ref: "DoctorProfile",  required: true },
    hospital:     { type: Schema.Types.ObjectId, ref: "Hospital",       required: true },

    symptoms: { type: [String], default: [] },

    abdomen: {
      distention:  { type: String, enum: ["None", "Mild", "Severe"],   default: "None" },
      tenderness:  { type: String, enum: ["None", "Epigastric", "RUQ", "RLQ", "LLQ", "Diffuse"], default: "None" },
      guarding:    { type: String, enum: ["None", "Guarding", "Rigidity"], default: "None" },
      masses:      { type: String, default: "" },
      bowelSounds: { type: String, enum: ["Normal", "Hyperactive", "Sluggish", "Absent"], default: "Normal" },
    },

    hernia: {
      present: { type: Boolean, default: false },
      site:    { type: String,  default: "" },
      type:    { type: String,  enum: ["Reducible", "Irreducible", "Obstructed", "Strangulated", "N/A"], default: "N/A" },
    },

    surgicalSite: {
      dressing:  { type: String, enum: ["Clean", "Soaked", "N/A"], default: "N/A" },
      infection: { type: Boolean, default: false },
      discharge: { type: String,  default: "" },
    },

    diagnosis: { type: String,  default: "" },
    plan:      { type: String,  enum: ["Conservative", "Surgical", "Emergency Surgery"], default: "Conservative" },

    notes: { type: String },
  },
  { timestamps: true }
);

GeneralSurgeryExaminationSchema.index({ hospital: 1, createdAt: -1 });
GeneralSurgeryExaminationSchema.index({ patientId:  1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
GeneralSurgeryExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IGeneralSurgeryExamination>(
  "GeneralSurgeryExamination",
  GeneralSurgeryExaminationSchema
);
