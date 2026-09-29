import mongoose, { Schema, Document } from "mongoose";

export interface IClinicalNote extends Document {
  patient: mongoose.Types.ObjectId;
  globalPatientId?: mongoose.Types.ObjectId;
  admission: mongoose.Types.ObjectId;
  author: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  type: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  isSigned: boolean;
  signedAt?: Date;
}

const clinicalNoteSchema = new Schema<IClinicalNote>(
  {
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    admission: {
      type: Schema.Types.ObjectId,
      ref: "IPDAdmission",
      required: true,
    },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    type: {
      type: String,
      required: true,
    },
    subjective: { type: String },
    objective: { type: String },
    assessment: { type: String },
    plan: { type: String },
    isSigned: { type: Boolean, default: false },
    signedAt: { type: Date },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
clinicalNoteSchema.plugin(multiTenancyPlugin);

clinicalNoteSchema.index({ globalPatientId: 1, hospital: 1 });
clinicalNoteSchema.index({ admission: 1, type: 1 });

const ClinicalNote = mongoose.model<IClinicalNote>(
  "ClinicalNote",
  clinicalNoteSchema,
);
export default ClinicalNote;
