import mongoose, { Schema, Document } from "mongoose";

export interface IEndocrinologyExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  // Glycemic Profile
  glycemic: {
    fbs:   number;
    ppbs:  number;
    hba1c: number;
  };

  // Thyroid Profile
  thyroid: {
    tsh: number;
    t3:  number;
    t4:  number;
  };

  // Body Parameters
  weight: number;
  height: number;
  bmi:    number;

  // Clinical Presentation
  symptoms: string[];

  // PCOS Profile
  pcos: {
    irregularCycles: boolean;
    hirsutism:       boolean;
    acne:            boolean;
    infertility:     boolean;
  };

  // Chronic Status
  complications: string[];
  medicationType: string[]; // Oral hypoglycemics, Insulin, Thyroxine, Anti-thyroid drugs

  notes?: string;

  // Diabetes Assessment (formerly standalone Diabetology)
  diabetes?: {
    fbs?:  number;
    ppbs?: number;
    hba1c?: number;
    symptoms?: {
      polyuria:    boolean;
      polydipsia:  boolean;
      polyphagia:  boolean;
      fatigue:     boolean;
      weightLoss:  boolean;
    };
    complications?: {
      neuropathy:  boolean;
      nephropathy: boolean;
      retinopathy: boolean;
    };
    hypoglycemia?: string;
    footExam?: {
      sensation?: string;
      ulcer?:     string;
      pulse?:     string;
    };
    treatment?: {
      type?:        string;
      insulinType?: string;
      dose?:        string;
    };
    comorbidities?: string[];
    notes?: string;
  };

  createdAt: Date;
  updatedAt: Date;
}

const EndocrinologyExaminationSchema: Schema = new Schema(
  {
    prescriptionId: { type: Schema.Types.ObjectId, ref: "Prescription",   required: true, index: true },
    patientId:      { type: Schema.Types.ObjectId, ref: "Patient",        required: true, index: true },
    doctorId:       { type: Schema.Types.ObjectId, ref: "DoctorProfile",  required: true },
    hospital:     { type: Schema.Types.ObjectId, ref: "Hospital",       required: true },

    glycemic: {
      fbs:   { type: Number },
      ppbs:  { type: Number },
      hba1c: { type: Number },
    },

    thyroid: {
      tsh: { type: Number },
      t3:  { type: Number },
      t4:  { type: Number },
    },

    weight: { type: Number },
    height: { type: Number },
    bmi:    { type: Number },

    symptoms: [{ type: String }],

    pcos: {
      irregularCycles: { type: Boolean, default: false },
      hirsutism:       { type: Boolean, default: false },
      acne:            { type: Boolean, default: false },
      infertility:     { type: Boolean, default: false },
    },

    complications: [{ type: String }],
    medicationType: [{ type: String }],

    // Diabetes Assessment (nested inside Endocrinology)
    diabetes: {
      fbs:   { type: Number },
      ppbs:  { type: Number },
      hba1c: { type: Number },
      symptoms: {
        polyuria:   { type: Boolean, default: false },
        polydipsia: { type: Boolean, default: false },
        polyphagia: { type: Boolean, default: false },
        fatigue:    { type: Boolean, default: false },
        weightLoss: { type: Boolean, default: false },
      },
      complications: {
        neuropathy:  { type: Boolean, default: false },
        nephropathy: { type: Boolean, default: false },
        retinopathy: { type: Boolean, default: false },
      },
      hypoglycemia: { type: String, enum: ["None", "Mild", "Severe"], default: "None" },
      footExam: {
        sensation: { type: String, enum: ["Normal", "Reduced", "Absent", ""], default: "" },
        ulcer:     { type: String, enum: ["Present", "Absent", ""], default: "" },
        pulse:     { type: String, enum: ["Normal", "Weak", ""], default: "" },
      },
      treatment: {
        type:        { type: String, enum: ["Oral drugs", "Insulin", "Both", ""], default: "" },
        insulinType: { type: String, enum: ["Basal", "Bolus", "Mixed", ""], default: "" },
        dose:        { type: String },
      },
      comorbidities: [{ type: String }],
      notes: { type: String },
    },

    notes: { type: String },
  },
  { timestamps: true },
);

EndocrinologyExaminationSchema.index({ hospital: 1, createdAt: -1 });
EndocrinologyExaminationSchema.index({ patientId:  1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
EndocrinologyExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IEndocrinologyExamination>(
  "EndocrinologyExamination",
  EndocrinologyExaminationSchema,
);
