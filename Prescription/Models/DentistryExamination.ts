import mongoose, { Schema, Document } from "mongoose";

export interface IDentistryExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  // A. Chief Complaint
  painScale: number; // 0-10
  duration:  string; // e.g., "3 days", "2 weeks"

  // B. Tooth-Level Assessment
  teeth: {
    toothNumber:   string; // FDI 11-48
    condition:     string; // e.g., "caries", "fracture"
    mobilityGrade: number; // 0-3
    tenderness:    boolean;
    cariesDepth:   "None" | "Mild" | "Moderate" | "Deep";
    diagnosis:     string;
  }[];

  // C. Oral Examination
  oralFindings: {
    caries:      "None" | "Mild" | "Moderate" | "Deep";
    gingivitis:  "None" | "Mild" | "Severe";
    abscess:     boolean;
    mobility:    "None" | "Grade 1" | "Grade 2" | "Grade 3";
    plaqueIndex: "Low" | "Moderate" | "High";
  };

  // D. Extraoral
  extraOral: {
    facialSwelling: boolean;
    lymphNodes:     boolean;
    tmjPain:        boolean;
  };

  // E. Systemic Risks
  systemicRisks: {
    onBloodThinners: boolean;
    diabetic:        boolean;
    diabetesControl: "Controlled" | "Uncontrolled" | "N/A";
  };

  // F. Procedure
  procedure: "Scaling" | "Filling" | "Root Canal Treatment" | "Extraction" | "Crown" | "Implant" | "Other";

  // Medications — dentistry specific linkage
  medications: string[];

  // Notes
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

const DentistryExaminationSchema: Schema = new Schema(
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

    painScale: {
      type: Number,
      required: true,
    },
    duration: {
      type: String,
      required: true,
    },

    teeth: [
      {
        toothNumber:   { type: String, required: true },
        condition:     { type: String },
        mobilityGrade: { type: Number,},
        tenderness:    { type: Boolean, default: false },
        cariesDepth:   { 
          type: String, 
          enum: ["None", "Mild", "Moderate", "Deep"],
          default: "None"
        },
        diagnosis:     { type: String },
      },
    ],

    oralFindings: {
      caries: {
        type: String,
        enum: ["None", "Mild", "Moderate", "Deep"],
        default: "None",
      },
      gingivitis: {
        type: String,
        enum: ["None", "Mild", "Severe"],
        default: "None",
      },
      abscess:     { type: Boolean, default: false },
      mobility: {
        type: String,
        enum: ["None", "Grade 1", "Grade 2", "Grade 3"],
        default: "None",
      },
      plaqueIndex: {
        type: String,
        enum: ["Low", "Moderate", "High"],
        default: "Low",
      },
    },

    extraOral: {
      facialSwelling: { type: Boolean, default: false },
      lymphNodes:     { type: Boolean, default: false },
      tmjPain:        { type: Boolean, default: false },
    },

    systemicRisks: {
      onBloodThinners: { type: Boolean, default: false },
      diabetic:        { type: Boolean, default: false },
      diabetesControl: {
        type: String,
        enum: ["Controlled", "Uncontrolled", "N/A"],
        default: "N/A",
      },
    },

    procedure: {
      type: String,
      enum: [
        "Scaling",
        "Filling",
        "Root Canal Treatment",
        "Extraction",
        "Crown",
        "Implant",
        "Other",
      ],
      required: true,
    },

    medications: [{ type: String }],
    notes: { type: String },
  },
  { timestamps: true }
);

// Indexes for performance
DentistryExaminationSchema.index({ hospital: 1, createdAt: -1 });
DentistryExaminationSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
DentistryExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IDentistryExamination>(
  "DentistryExamination",
  DentistryExaminationSchema
);
