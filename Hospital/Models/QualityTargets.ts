import mongoose, { Schema, Document } from "mongoose";

export interface IQualityTargets extends Document {
  hospital: mongoose.Types.ObjectId;
  opdWaitingTime: number; // minutes — target: less than X
  bedOccupancyMin: number; // % — target range minimum
  bedOccupancyMax: number; // % — target range maximum
  alos: number; // days — target: less than X
  billingTat: number; // minutes — target: less than X
  incidentRateMax: number; // ‰ — target: less than X (or raw count/month when low data)
  incidentCountMax: number; // raw count/month threshold (used when bed-days < 30)
  readmissionRate: number; // % — target: less than X
  updatedAt: Date;
}

const QualityTargetsSchema = new Schema<IQualityTargets>(
  {
    hospital: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      unique: true,
    },
    opdWaitingTime: { type: Number, default: 30 },
    bedOccupancyMin: { type: Number, default: 80 },
    bedOccupancyMax: { type: Number, default: 90 },
    alos: { type: Number, default: 5 },
    billingTat: { type: Number, default: 180 },
    incidentRateMax: { type: Number, default: 1 },
    incidentCountMax: { type: Number, default: 5 },
    readmissionRate: { type: Number, default: 5 },
  },
  { timestamps: true },
);

export default mongoose.model<IQualityTargets>(
  "QualityTargets",
  QualityTargetsSchema,
);
