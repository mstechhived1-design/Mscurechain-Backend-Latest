import mongoose, { Schema, Document } from "mongoose";

export interface IDietLog extends Document {
  patient: mongoose.Types.ObjectId;
  globalPatientId?: mongoose.Types.ObjectId;
  admission: mongoose.Types.ObjectId;
  recordedBy: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  items: {
    name: string;
    quantity?: string;
    calories?: number | string;
  }[];
  category: "Morning" | "Afternoon" | "Evening" | "Night" | "Day" | string;
  recordedDate: string; // YYYY-MM-DD
  recordedTime: string; // HH:mm
  timestamp: Date;
  notes?: string;
}

const dietLogSchema = new Schema<IDietLog>(
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
    items: [
      {
        name: { type: String, required: true },
        quantity: { type: String },
        calories: { type: Schema.Types.Mixed }, // Can be number or string descriptive
      },
    ],
    category: { type: String, required: true },
    recordedDate: { type: String, required: true },
    recordedTime: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    notes: { type: String },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
dietLogSchema.plugin(multiTenancyPlugin);

dietLogSchema.index({ globalPatientId: 1, hospital: 1 });
dietLogSchema.index({ admission: 1, recordedDate: -1 });

const DietLog = mongoose.model<IDietLog>("DietLog", dietLogSchema);
export default DietLog;
