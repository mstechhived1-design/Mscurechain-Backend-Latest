import mongoose, { Schema, Document } from "mongoose";

export interface IOrthopedicExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  // A. Region / Joint
  joint: "Neck" | "Shoulder" | "Elbow" | "Wrist" | "Spine" | "Hip" | "Knee" | "Ankle" | "";
  side:  "Left" | "Right" | "Bilateral" | "";

  // B. Pain Assessment
  pain: {
    score: number;
    type:  "Sharp" | "Dull" | "Radiating" | "Burning" | "";
  };

  // C. Range of Motion (ROM)
  rom: "Normal" | "Restricted" | "Painful" | "Severely restricted" | "";

  // D. Physical Examination
  exam: {
    swelling:   "Yes" | "No" | "";
    tenderness: "None" | "Mild" | "Severe" | "";
    deformity:  "Present" | "Absent" | "";
    spasm:      "Yes" | "No" | "";
  };

  // E. Motor Power (0-5 scale)
  motorPower?: number;

  // F. Neurovascular Status
  neurovascular: {
    sensation: "Normal" | "Reduced" | "Absent" | "";
    pulse:     "Normal" | "Weak" | "Absent" | "";
  };

  // G. Special Tests
  specialTests: string[];

  // H. Imaging
  imaging: {
    xray: "Normal" | "Fracture" | "Degenerative changes" | "";
    mri:  "Normal" | "Ligament tear" | "Disc prolapse" | "";
  };

  // I. Diagnosis
  diagnosis: string;
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

const OrthopedicExaminationSchema: Schema = new Schema(
  {
    prescriptionId: { type: Schema.Types.ObjectId, ref: "Prescription",   required: true, index: true },
    patientId:      { type: Schema.Types.ObjectId, ref: "Patient",        required: true, index: true },
    doctorId:       { type: Schema.Types.ObjectId, ref: "DoctorProfile",  required: true },
    hospital:     { type: Schema.Types.ObjectId, ref: "Hospital",       required: true },

    joint: { 
      type: String, 
      enum: ["Neck", "Shoulder", "Elbow", "Wrist", "Spine", "Hip", "Knee", "Ankle", ""],
      required: [true, "Joint/Region is required"]
    },
    side: { 
      type: String, 
      enum: ["Left", "Right", "Bilateral", ""],
      required: [true, "Side is required"]
    },

    pain: {
      score: { type: Number, default: 0 },
      type:  { type: String, enum: ["Sharp", "Dull", "Radiating", "Burning", ""], default: "" },
    },

    rom: { 
      type: String, 
      enum: ["Normal", "Restricted", "Painful", "Severely restricted", ""],
      required: [true, "Range of Motion is required"]
    },

    exam: {
      swelling:   { type: String, enum: ["Yes", "No", ""], default: "" },
      tenderness: { type: String, enum: ["None", "Mild", "Severe", ""], default: "" },
      deformity:  { type: String, enum: ["Present", "Absent", ""], default: "" },
      spasm:      { type: String, enum: ["Yes", "No", ""], default: "" },
    },

    motorPower: { type: Number,},

    neurovascular: {
      sensation: { type: String, enum: ["Normal", "Reduced", "Absent", ""], default: "" },
      pulse:     { type: String, enum: ["Normal", "Weak", "Absent", ""], default: "" },
    },

    specialTests: [{ type: String }],

    imaging: {
      xray: { type: String, enum: ["Normal", "Fracture", "Degenerative changes", ""], default: "" },
      mri:  { type: String, enum: ["Normal", "Ligament tear", "Disc prolapse", ""], default: "" },
    },

    diagnosis: { type: String, default: "" },
    notes:     { type: String },
  },
  { timestamps: true },
);

OrthopedicExaminationSchema.index({ hospital: 1, createdAt: -1 });
OrthopedicExaminationSchema.index({ patientId:  1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
OrthopedicExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IOrthopedicExamination>(
  "OrthopedicExamination",
  OrthopedicExaminationSchema,
);
