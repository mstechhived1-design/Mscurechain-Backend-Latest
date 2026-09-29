import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IVitalThreshold extends Document {
  hospital: mongoose.Types.ObjectId;
  templateId: mongoose.Types.ObjectId;
  vitalName: string; // heartRate, spO2, systolicBP, diastolicBP, temperature, respiratoryRate, glucose
  glucoseType?: "Fasting" | "After Meal" | "Random";
  physicalMin: number;
  lowerCritical: number;
  lowerWarning: number;
  targetMin: number;
  targetMax: number;
  upperWarning: number;
  upperCritical: number;
  physicalMax: number;
  unit: string;
  escalationCriticalMinutes: number;
  escalationWarningMinutes: number;
  isSpO2UpperEnabled?: boolean; // Special rule for SpO2 upper threshold
}

const vitalThresholdSchema = new Schema<IVitalThreshold>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    templateId: {
      type: Schema.Types.ObjectId,
      ref: "VitalsThresholdTemplate",
      required: true,
    },
    vitalName: { type: String, required: true },
    glucoseType: { type: String, enum: ["Fasting", "After Meal", "Random"] },
    physicalMin: { type: Number, required: true },
    lowerCritical: { type: Number, required: true },
    lowerWarning: { type: Number, required: true },
    targetMin: { type: Number, required: true },
    targetMax: { type: Number, required: true },
    upperWarning: { type: Number, required: true },
    upperCritical: { type: Number, required: true },
    physicalMax: { type: Number, required: true },
    unit: { type: String, required: true },
    escalationCriticalMinutes: { type: Number, default: 60 },
    escalationWarningMinutes: { type: Number, default: 480 },
    isSpO2UpperEnabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Index for hospital-based queries
vitalThresholdSchema; // .index({ hospital: 1 }) removed to prevent duplicate index with tenantPlugin;
// Ensure unique vital + glucoseType combination per template
vitalThresholdSchema.index(
  { hospital: 1, templateId: 1, vitalName: 1, glucoseType: 1 },
  { unique: true },
);

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
vitalThresholdSchema.plugin(multiTenancyPlugin);

const VitalThreshold = mongoose.model<IVitalThreshold>(
  "VitalThreshold",
  vitalThresholdSchema,
);
export default VitalThreshold;
