import mongoose, { Schema, Document } from "mongoose";

export interface IGastroExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  // A. Symptoms (multi-select)
  symptoms: (
    | "Abdominal Pain"
    | "Vomiting"
    | "Nausea"
    | "Diarrhea"
    | "Constipation"
    | "Bloating"
    | "Loss of appetite"
    | "Blood in stool"
    | "Black stool (Melena)"
    | "Blood in vomit (Hematemesis)"
  )[];

  // B. Pain character
  painLocation: "Epigastric" | "RUQ" | "RLQ" | "LLQ" | "Diffuse" | "";
  painType:     "Burning" | "Colicky" | "Sharp" | "";

  // C. Bowel habits
  bowelHabits: "Normal" | "Constipation" | "Diarrhea" | "Alternating";

  // D. Stool character
  stoolType: "Normal" | "Loose" | "Hard" | "Black (Melena)" | "Blood-stained";

  // E. Examination
  bowelSounds: "Normal" | "Hyperactive" | "Sluggish" | "Absent";
  distention:  "None" | "Mild" | "Severe";
  tenderness:  "None" | "Epigastric" | "RUQ" | "RLQ" | "Diffuse";

  // Organomegaly — structured
  liver: {
    status: "Not palpable" | "Enlarged";
    size?:  number;   // cm — required when Enlarged
  };
  spleen: {
    status: "Not palpable" | "Enlarged";
  };

  // Guarding / rigidity
  guarding: "None" | "Guarding" | "Rigidity" | "Palpable Mass";

  // F. Diagnosis
  diagnosis:
    | "GERD"
    | "Gastritis"
    | "PUD"
    | "IBS"
    | "IBD"
    | "Hepatitis"
    | "Fatty Liver"
    | "Cirrhosis"
    | "Pancreatitis"
    | "";

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const GastroExaminationSchema: Schema = new Schema(
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

    // A. Symptoms
    symptoms: {
      type: [String],
      enum: [
        "Abdominal Pain",
        "Vomiting",
        "Nausea",
        "Diarrhea",
        "Constipation",
        "Bloating",
        "Loss of appetite",
        "Blood in stool",
        "Black stool (Melena)",
        "Blood in vomit (Hematemesis)",
      ],
      validate: {
        validator: function (v: string[]) {
          return v && v.length > 0;
        },
        message: "At least one symptom must be recorded",
      },
    },

    // B. Pain character
    painLocation: {
      type: String,
      enum: ["Epigastric", "RUQ", "RLQ", "LLQ", "Diffuse", ""],
      default: "",
    },
    painType: {
      type: String,
      enum: ["Burning", "Colicky", "Sharp", ""],
      default: "",
    },

    // C. Bowel habits — REQUIRED
    bowelHabits: {
      type: String,
      enum: ["Normal", "Constipation", "Diarrhea", "Alternating"],
      required: [true, "Bowel habits are required"],
    },

    // D. Stool character
    stoolType: {
      type: String,
      enum: ["Normal", "Loose", "Hard", "Black (Melena)", "Blood-stained"],
      default: "Normal",
    },

    // E. Examination
    bowelSounds: {
      type: String,
      enum: ["Normal", "Hyperactive", "Sluggish", "Absent"],
      default: "Normal",
    },
    distention: {
      type: String,
      enum: ["None", "Mild", "Severe"],
      default: "None",
    },
    tenderness: {
      type: String,
      enum: ["None", "Epigastric", "RUQ", "RLQ", "Diffuse"],
      required: [true, "Tenderness must be documented"],
    },

    // Organomegaly — structured
    liver: {
      status: {
        type: String,
        enum: ["Not palpable", "Enlarged"],
        default: "Not palpable",
      },
      size: {
        type: Number,
      },
    },
    spleen: {
      status: {
        type: String,
        enum: ["Not palpable", "Enlarged"],
        default: "Not palpable",
      },
    },

    // Guarding
    guarding: {
      type: String,
      enum: ["None", "Guarding", "Rigidity", "Palpable Mass"],
      default: "None",
    },

    // F. Diagnosis
    diagnosis: {
      type: String,
      enum: [
        "GERD",
        "Gastritis",
        "PUD",
        "IBS",
        "IBD",
        "Hepatitis",
        "Fatty Liver",
        "Cirrhosis",
        "Pancreatitis",
        "",
      ],
      default: "",
    },

    notes: { type: String },
  },
  { timestamps: true },
);

// Compound indices for analytics
GastroExaminationSchema.index({ hospital: 1, createdAt: -1 });
GastroExaminationSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
GastroExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IGastroExamination>(
  "GastroExamination",
  GastroExaminationSchema,
);
