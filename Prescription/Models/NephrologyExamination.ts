import mongoose, { Schema, Document } from "mongoose";

export interface INephrologyExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  // A. Renal Function — all required
  creatinine: number;   // mg/dL
  urea:       number;   // mg/dL
  egfr:       number;   // ml/min

  // B. Electrolytes
  electrolytes: {
    sodium?:      number;   // mEq/L
    potassium?:   number;   // mEq/L  ← CRITICAL
    bicarbonate?: number;   // mEq/L
  };

  // C. Urine Output — required
  urineOutput: number;  // ml/24h

  // D. Urine Analysis — structured
  urineAnalysis: {
    protein: "Nil" | "Trace" | "1+" | "2+" | "3+";
    sugar:   "Nil" | "Present";
    rbc:     "Nil" | "Present";
  };

  // E. Fluid Balance
  fluidBalance: {
    intake?: number;   // ml/24h
    output?: number;   // ml/24h
  };

  // F. Edema
  edema: "None" | "Trace" | "1+" | "2+" | "3+" | "4+";

  // G. Dialysis — structured
  dialysis: {
    status:       "Not on dialysis" | "Hemodialysis" | "Peritoneal dialysis";
    frequency?:   string;        // e.g. "2/week"
    lastSession?: Date;
    access?:      "AV fistula" | "Catheter" | "";
  };

  // H. Symptoms
  symptoms: string[];

  // I. CKD Stage
  ckdStage: "Stage 1" | "Stage 2" | "Stage 3" | "Stage 4" | "Stage 5" | "";

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NephrologyExaminationSchema: Schema = new Schema(
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

    // A. Renal Function
    creatinine: {
      type: Number,
      required: [true, "Serum Creatinine is required"],
    },
    urea: {
      type: Number,
      required: [true, "Blood Urea is required"],
    },
    egfr: {
      type: Number,
      required: [true, "eGFR is required"],
    },

    // B. Electrolytes
    electrolytes: {
      sodium: {
        type: Number,
      },
      potassium: {
        type: Number,
        validate: {
          validator: function (v: number) {
            if (v > 6.0) {
              throw new Error("HYPERKALEMIA EMERGENCY: K+ > 6.0 — cardiac arrest risk");
            }
            return true;
          },
          message: (props: any) => props.reason?.message || "Potassium out of safe range",
        },
      },
      bicarbonate: {
        type: Number,
      },
    },

    // C. Urine Output
    urineOutput: {
      type: Number,
      required: [true, "Urine Output (ml/24h) is required"],
    },

    // D. Urine Analysis (structured)
    urineAnalysis: {
      protein: { type: String, enum: ["Nil", "Trace", "1+", "2+", "3+"], default: "Nil" },
      sugar:   { type: String, enum: ["Nil", "Present"],                  default: "Nil" },
      rbc:     { type: String, enum: ["Nil", "Present"],                  default: "Nil" },
    },

    // E. Fluid Balance
    fluidBalance: {
      intake: { type: Number,},
      output: { type: Number,},
    },

    // F. Edema
    edema: {
      type: String,
      enum: ["None", "Trace", "1+", "2+", "3+", "4+"],
      default: "None",
    },

    // G. Dialysis (structured)
    dialysis: {
      status: {
        type: String,
        enum: ["Not on dialysis", "Hemodialysis", "Peritoneal dialysis"],
        default: "Not on dialysis",
      },
      frequency:   { type: String },
      lastSession: { type: Date },
      access: {
        type: String,
        enum: ["AV fistula", "Catheter", ""],
        default: "",
      },
    },

    // H. Symptoms
    symptoms: {
      type: [String],
      enum: ["Reduced urine", "Swelling", "Breathlessness", "Nausea", "Fatigue", "Confusion"],
      default: [],
    },

    // I. CKD Stage
    ckdStage: {
      type: String,
      enum: ["Stage 1", "Stage 2", "Stage 3", "Stage 4", "Stage 5", ""],
      default: "",
    },

    notes: { type: String },
  },
  { timestamps: true },
);

// Compound indices for analytics
NephrologyExaminationSchema.index({ hospital: 1, createdAt: -1 });
NephrologyExaminationSchema.index({ patientId:  1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
NephrologyExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<INephrologyExamination>(
  "NephrologyExamination",
  NephrologyExaminationSchema,
);
