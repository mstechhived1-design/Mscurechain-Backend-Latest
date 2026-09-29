import mongoose, { Schema, Document } from "mongoose";

export interface IVitalsRecord extends Document {
  patient: mongoose.Types.ObjectId;
  globalPatientId?: mongoose.Types.ObjectId;
  admission: mongoose.Types.ObjectId;
  recordedBy: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  heartRate: number;
  systolicBP: number;
  diastolicBP: number;
  spO2: number;
  temperature: number;
  respiratoryRate?: number;
  glucose?: number;
  glucoseType?: "Fasting" | "After Meal" | "Random";
  status: "Stable" | "Warning" | "Critical";
  condition: string;
  notes?: string;
  timestamp: Date;
}

const vitalsRecordSchema = new Schema<IVitalsRecord>(
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
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    heartRate: { type: Number, required: true },
    systolicBP: { type: Number, required: true },
    diastolicBP: { type: Number, required: true },
    spO2: { type: Number, required: true },
    temperature: { type: Number, required: true },
    respiratoryRate: { type: Number },
    glucose: { type: Number },
    glucoseType: { type: String, enum: ["Fasting", "After Meal", "Random"] },
    status: {
      type: String,
      enum: ["Stable", "Warning", "Critical"],
      default: "Stable",
    },
    condition: { type: String },
    notes: { type: String },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
vitalsRecordSchema.plugin(multiTenancyPlugin);

vitalsRecordSchema.index({ globalPatientId: 1, hospital: 1 });
vitalsRecordSchema.index({ admission: 1, createdAt: -1 });

const VitalsRecord = mongoose.model<IVitalsRecord>(
  "VitalsRecord",
  vitalsRecordSchema,
);
export default VitalsRecord;
