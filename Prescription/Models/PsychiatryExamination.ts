import mongoose, { Schema, Document } from "mongoose";

export interface IPsychiatryExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  // Complaints & History
  complaints: string[];
  severity:   "Mild" | "Moderate" | "Severe" | "";
  duration:   number; // in days

  // Mental Status Examination (MSE)
  mse: {
    behavior:   "Normal" | "Agitated" | "Withdrawn" | "";
    speech:     "Normal" | "Pressured" | "Slowed" | "";
    mood:       "Normal" | "Depressed" | "Elevated" | "Irritable" | "";
    thought:    string[]; // Delusions, Hallucinations, Suicidal thoughts, Homicidal thoughts
    perception: "Normal" | "Hallucinations" | "";
    insight:    number; // 1-5
    judgment:   number; // 1-5
  };

  // Risk Assessment
  suicideRisk: "None" | "Low" | "Moderate" | "High";

  // Standardized Scores
  scores: {
    phq9: number; // 0-27
    gad7: number; // 0-21
  };

  substanceUse: string[];
  medicationCompliance: "Good" | "Poor" | "";
  sideEffects: string[];

  counseling?: string;
  notes?:      string;

  createdAt: Date;
  updatedAt: Date;
}

const PsychiatryExaminationSchema: Schema = new Schema(
  {
    prescriptionId: { type: Schema.Types.ObjectId, ref: "Prescription",   required: true, index: true },
    patientId:      { type: Schema.Types.ObjectId, ref: "Patient",        required: true, index: true },
    doctorId:       { type: Schema.Types.ObjectId, ref: "DoctorProfile",  required: true },
    hospital:     { type: Schema.Types.ObjectId, ref: "Hospital",       required: true },

    complaints: [{ type: String }],
    severity:   { type: String, enum: ["Mild", "Moderate", "Severe", ""], default: "" },
    duration:   { type: Number },

    mse: {
      behavior:   { type: String, enum: ["Normal", "Agitated", "Withdrawn", ""], default: "" },
      speech:     { type: String, enum: ["Normal", "Pressured", "Slowed", ""], default: "" },
      mood:       { type: String, enum: ["Normal", "Depressed", "Elevated", "Irritable", ""], default: "" },
      thought:    [{ type: String }],
      perception: { type: String, enum: ["Normal", "Hallucinations", ""], default: "" },
      insight:    { type: Number,},
      judgment:   { type: Number,},
    },

    suicideRisk: { type: String, enum: ["None", "Low", "Moderate", "High"], default: "None" },

    scores: {
      phq9: { type: Number,},
      gad7: { type: Number,},
    },

    substanceUse: [{ type: String }],
    medicationCompliance: { type: String, enum: ["Good", "Poor", ""], default: "" },
    sideEffects: [{ type: String }],

    counseling: { type: String },
    notes:      { type: String },
  },
  { timestamps: true },
);

PsychiatryExaminationSchema.index({ hospital: 1, createdAt: -1 });
PsychiatryExaminationSchema.index({ patientId:  1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
PsychiatryExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IPsychiatryExamination>(
  "PsychiatryExamination",
  PsychiatryExaminationSchema,
);
