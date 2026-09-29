import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IQualityMetric extends Document {
  hospital: mongoose.Types.ObjectId;
  month: number; // 1-12
  year: number;
  indicators: {
    opdWaitingTime: number; // in minutes
    bedOccupancyRate: number; // percentage
    alos: number; // in days
    billingTat: number; // in minutes
    incidentRate: number; // per 1000 patient days
    readmissionRate: number; // percentage
  };
  rawCounts: {
    totalOpdVisits: number;
    totalAdmissions: number;
    totalDischarges: number;
    totalInfections: number;
    totalIncidents: number;
    totalReadmissions: number;
    totalOccupiedBedDays: number;
    totalAvailableBedDays: number;
  };
  dataGaps: {
    missingDiagnoses: number;
    untrackedInfections: number;
    emptyArrivalTimes: number;
  };
  complianceScore: number;
  status: "open" | "locked";
  lockedAt?: Date;
  lockedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const QualityMetricSchema: Schema = new Schema(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    indicators: {
      opdWaitingTime: { type: Number, default: 0 },
      bedOccupancyRate: { type: Number, default: 0 },
      alos: { type: Number, default: 0 },
      billingTat: { type: Number, default: 0 },
      incidentRate: { type: Number, default: 0 },
      readmissionRate: { type: Number, default: 0 },
    },
    rawCounts: {
      totalOpdVisits: { type: Number, default: 0 },
      totalAdmissions: { type: Number, default: 0 },
      totalDischarges: { type: Number, default: 0 },
      totalInfections: { type: Number, default: 0 },
      totalIncidents: { type: Number, default: 0 },
      totalReadmissions: { type: Number, default: 0 },
      totalOccupiedBedDays: { type: Number, default: 0 },
      totalAvailableBedDays: { type: Number, default: 0 },
    },
    dataGaps: {
      missingDiagnoses: { type: Number, default: 0 },
      untrackedInfections: { type: Number, default: 0 },
      emptyArrivalTimes: { type: Number, default: 0 },
    },
    complianceScore: { type: Number, default: 0 },
    status: { type: String, enum: ["open", "locked"], default: "open" },
    lockedAt: { type: Date },
    lockedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Ensure one metric record per hospital per month
QualityMetricSchema.index({ hospital: 1, month: 1, year: 1 }, { unique: true });

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
QualityMetricSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IQualityMetric>(
  "QualityMetric",
  QualityMetricSchema,
);
