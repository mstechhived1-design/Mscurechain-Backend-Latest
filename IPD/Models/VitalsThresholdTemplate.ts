import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IVitalsThresholdTemplate extends Document {
  hospital: mongoose.Types.ObjectId;
  templateName: string; // ICU / Emergency / General / Custom
  wardType: string; // The ward type this template applies to
  monitoringFrequency: {
    critical: number; // hours
    warning: number; // hours
  };
  createdBy: mongoose.Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const vitalsThresholdTemplateSchema = new Schema<IVitalsThresholdTemplate>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    templateName: { type: String, required: true },
    wardType: { type: String, required: true },
    monitoringFrequency: {
      critical: { type: Number, default: 1 },
      warning: { type: Number, default: 8 },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Unique template name per hospital
vitalsThresholdTemplateSchema.index(
  { hospital: 1, templateName: 1 },
  { unique: true },
);

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
vitalsThresholdTemplateSchema.plugin(multiTenancyPlugin);

const VitalsThresholdTemplate = mongoose.model<IVitalsThresholdTemplate>(
  "VitalsThresholdTemplate",
  vitalsThresholdTemplateSchema,
);
export default VitalsThresholdTemplate;
