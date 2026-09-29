import mongoose, { Schema, Document } from "mongoose";

export interface IQualityIndicator extends Document {
  name: string;
  department: "OPD" | "IPD" | "ICU" | "Hospital-wide";
  problemIdentified?: string;
  baselineValue?: number;
  targetValue?: number;
  currentValue?: number;
  actionTaken?: string;
  status: "Pending" | "In Progress" | "Improved" | "Closed";
  hospitalId: mongoose.Types.ObjectId;
}

const QualityIndicatorSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    department: {
      type: String,
      required: true,
      enum: ["OPD", "IPD", "ICU", "Hospital-wide"],
      default: "Hospital-wide",
    },
    problemIdentified: {
      type: String,
    },
    baselineValue: {
      type: Number,
      default: 0,
    },
    targetValue: {
      type: Number,
      default: 0,
    },
    currentValue: {
      type: Number,
      default: 0,
    },
    actionTaken: {
      type: String,
    },
    status: {
      type: String,
      required: true,
      enum: ["Pending", "In Progress", "Improved", "Closed"],
      default: "Pending",
    },
    unit: {
      type: String,
      default: "%",
    },
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
QualityIndicatorSchema.plugin(multiTenancyPlugin, {
  tenantField: "hospitalId",
});

export default mongoose.models.QualityIndicator ||
  mongoose.model<IQualityIndicator>("QualityIndicator", QualityIndicatorSchema);
