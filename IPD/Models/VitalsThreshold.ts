import mongoose, { Schema } from "mongoose";
import { IVitalsThreshold } from "../types/index.js";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

const thresholdSchema = new Schema(
  {
    minPossible: { type: Number, required: true },
    maxPossible: { type: Number, required: true },
    lowCritical: { type: Number, required: true },
    lowWarning: { type: Number, required: true },
    highWarning: { type: Number, required: true },
    highCritical: { type: Number, required: true },
  },
  { _id: false },
);

const vitalsThresholdSchema = new Schema<IVitalsThreshold>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    wardType: {
      type: String,
      required: true,
    },
    thresholds: {
      heartRate: { type: thresholdSchema, required: true },
      spO2: { type: thresholdSchema, required: true },
      systolicBP: { type: thresholdSchema, required: true },
      diastolicBP: { type: thresholdSchema, required: true },
      temperature: { type: thresholdSchema, required: true },
      respiratoryRate: { type: thresholdSchema, required: true },
      glucose: {
        fasting: { type: thresholdSchema, required: true },
        afterMeal: { type: thresholdSchema, required: true },
        random: { type: thresholdSchema, required: true },
      },
    },
    monitoringFrequency: {
      critical: { type: Number, default: 1 }, // hours
      warning: { type: Number, default: 8 }, // hours (approx one shift)
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Ensure only one active threshold set per hospital/ward type
vitalsThresholdSchema.index({ hospital: 1, wardType: 1 }, { unique: true });

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
vitalsThresholdSchema.plugin(multiTenancyPlugin);

const VitalsThreshold = mongoose.model<IVitalsThreshold>(
  "VitalsThreshold",
  vitalsThresholdSchema,
);
export default VitalsThreshold;
