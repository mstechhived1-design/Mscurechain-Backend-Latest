import mongoose, { Schema, Document } from "mongoose";

export interface IOncologyExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  body: {
    weight: number;
    height: number;
    bsa: number;
  };

  diagnosis: string;
  site: string;
  ecog: number;

  biomarkers: string[];

  tnm: {
    t: string;
    n: string;
    m: string;
    stage: string;
  };

  treatment: {
    intent: string;
    modality: string[];
    regimen: string;
  };

  chemo: {
    drug: string;
    dosePerM2: number;
    totalDose: number;
    cycle: number;
    day: number;
    route: string;
    preMeds: string;
    notes: string;
  }[];

  labs: {
    hb: number;
    anc: number;
    platelets: number;
    creatinine: number;
    lft: number;
  };

  toxicity: string[];

  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

const OncologyExaminationSchema: Schema = new Schema(
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

    body: {
      weight: { type: Number, required: true },
      height: { type: Number, required: true },
      bsa: { type: Number, required: true },
    },

    diagnosis: { type: String, required: true },
    site: { type: String, required: true },
    ecog: { type: Number, required: true },

    biomarkers: { type: [String], default: [] },

    tnm: {
      t: { type: String, required: true },
      n: { type: String, required: true },
      m: { type: String, required: true },
      stage: { type: String },
    },

    treatment: {
      intent: { type: String, required: true },
      modality: { type: [String], default: [] },
      regimen: { type: String },
    },

    chemo: [
      {
        drug: { type: String, required: true },
        dosePerM2: { type: Number, required: true },
        totalDose: { type: Number, required: true },
        cycle: { type: Number },
        day: { type: Number },
        route: { type: String },
        preMeds: { type: String },
        notes: { type: String },
      },
    ],

    labs: {
      hb: { type: Number, required: true },
      anc: { type: Number, required: true },
      platelets: { type: Number, required: true },
      creatinine: { type: Number, required: true },
      lft: { type: Number, required: true },
    },

    toxicity: { type: [String], default: [] },

    notes: { type: String },
  },
  { timestamps: true }
);

// Compound indices for multi-tenancy and performance
OncologyExaminationSchema.index({ hospital: 1, createdAt: -1 });
OncologyExaminationSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
OncologyExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IOncologyExamination>(
  "OncologyExamination",
  OncologyExaminationSchema
);
