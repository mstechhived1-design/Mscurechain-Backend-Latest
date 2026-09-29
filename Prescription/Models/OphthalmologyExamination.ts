import mongoose, { Schema, Document } from "mongoose";

export interface IOphthalmologyExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  // A. Visual Acuity — OD + OS, Unaided + Corrected
  vision: {
    od: { unaided: string; corrected: string };
    os: { unaided: string; corrected: string };
  };

  // B. Refraction
  refraction: {
    od: { sph?: number; cyl?: number; axis?: number };
    os: { sph?: number; cyl?: number; axis?: number };
  };

  // C. IOP (mmHg) — OD + OS
  iop: { od?: number; os?: number };

  // D. Pupils
  pupils: "PERRLA" | "Sluggish" | "Fixed" | "";

  // E. Symptoms
  symptoms: string[];

  // F. Slit Lamp
  slitLamp: {
    conjunctiva:     "Normal" | "Congested" | "Pale" | "";
    cornea:          "Clear"  | "Ulcer"     | "Opacity" | "";
    anteriorChamber: "Normal" | "Shallow"   | "Deep" | "";
    lens:            "Clear"  | "Cataract"  | "Mature cataract" | "";
  };

  // G. Fundus
  fundus: {
    retina:    "Normal" | "Detachment" | "Degeneration" | "";
    opticDisc: "Normal" | "Cupping increased" | "";
    macula:    "Normal" | "Edema" | "";
  };

  // H. Diagnosis
  diagnosis: "Conjunctivitis" | "Dry Eye" | "Cataract" | "Glaucoma" | "Refractive Error" | "Corneal Ulcer" | "";

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const VISION_REGEX = /^(PL\+?|HM|CF\s*\d*cm?|NPL|6\/\d{1,3}|N\d{1,2}|LogMAR[\s\d.]+|5\/\d+)$/i;

const OphthalmologyExaminationSchema: Schema = new Schema(
  {
    prescriptionId: { type: Schema.Types.ObjectId, ref: "Prescription",   required: true, index: true },
    patientId:      { type: Schema.Types.ObjectId, ref: "Patient",        required: true, index: true },
    doctorId:       { type: Schema.Types.ObjectId, ref: "DoctorProfile",  required: true },
    hospital:     { type: Schema.Types.ObjectId, ref: "Hospital",       required: true },

    // A. Vision
    vision: {
      od: {
        unaided:   { type: String, required: [true, "OD unaided vision is required"] },
        corrected: { type: String, default: "" },
      },
      os: {
        unaided:   { type: String, required: [true, "OS unaided vision is required"] },
        corrected: { type: String, default: "" },
      },
    },

    // B. Refraction
    refraction: {
      od: {
        sph:  { type: Number },
        cyl:  { type: Number },
        axis: { type: Number,},
      },
      os: {
        sph:  { type: Number },
        cyl:  { type: Number },
        axis: { type: Number,},
      },
    },

    // C. IOP
    iop: {
      od: { type: Number,},
      os: { type: Number,},
    },

    // D. Pupils
    pupils: { type: String, enum: ["PERRLA", "Sluggish", "Fixed", ""], default: "" },

    // E. Symptoms
    symptoms: {
      type: [String],
      enum: [
        "Redness", "Pain", "Watering", "Itching", "Blurred Vision",
        "Photophobia", "Discharge", "Foreign Body Sensation", "Sudden Vision Loss",
      ],
      default: [],
    },

    // F. Slit Lamp
    slitLamp: {
      conjunctiva:     { type: String, enum: ["Normal", "Congested", "Pale",          ""], default: "" },
      cornea:          { type: String, enum: ["Clear",  "Ulcer",     "Opacity",        ""], default: "" },
      anteriorChamber: { type: String, enum: ["Normal", "Shallow",   "Deep",           ""], default: "" },
      lens:            { type: String, enum: ["Clear",  "Cataract",  "Mature cataract", ""], default: "" },
    },

    // G. Fundus
    fundus: {
      retina:    { type: String, enum: ["Normal", "Detachment",        "Degeneration",    ""], default: "" },
      opticDisc: { type: String, enum: ["Normal", "Cupping increased", ""],                    default: "" },
      macula:    { type: String, enum: ["Normal", "Edema",             ""],                    default: "" },
    },

    // H. Diagnosis
    diagnosis: {
      type: String,
      enum: ["Conjunctivitis", "Dry Eye", "Cataract", "Glaucoma", "Refractive Error", "Corneal Ulcer", ""],
      default: "",
    },

    notes: { type: String },
  },
  { timestamps: true },
);

OphthalmologyExaminationSchema.index({ hospital: 1, createdAt: -1 });
OphthalmologyExaminationSchema.index({ patientId:  1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
OphthalmologyExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IOphthalmologyExamination>(
  "OphthalmologyExamination",
  OphthalmologyExaminationSchema,
);
