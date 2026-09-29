import mongoose, { Schema, Document } from "mongoose";

export interface IPerformance extends Document {
  user: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  period: string; // e.g., "Q1 2024", "Monthly - March 2024"
  score: number; // 1 to 5
  status: "pending" | "completed";
  reviewDate: Date;
  reviewer: mongoose.Types.ObjectId;
  notes: string;
  metrics: {
    attendanceRate: number;
    tasksCompleted?: number;
    punctualityScore: number;
    behaviorScore: number;
    teamCollaboration: number;
    technicalSkills: number;
    patientFeedbackScore?: number;
  };
}

const performanceSchema = new Schema<IPerformance>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    period: { type: String, required: true },
    score: { type: Number, required: true, min: 1, max: 5 },
    status: {
      type: String,
      enum: ["pending", "completed"],
      default: "pending",
    },
    reviewDate: { type: Date, default: Date.now },
    reviewer: { type: Schema.Types.ObjectId, ref: "User" },
    notes: { type: String },
    metrics: {
      attendanceRate: { type: Number, default: 0 },
      tasksCompleted: { type: Number, default: 0 },
      punctualityScore: { type: Number, default: 0 },
      behaviorScore: { type: Number, default: 0 },
      teamCollaboration: { type: Number, default: 0 },
      technicalSkills: { type: Number, default: 0 },
      patientFeedbackScore: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
performanceSchema.plugin(multiTenancyPlugin);

performanceSchema.index({ hospital: 1, period: 1 });
performanceSchema.index({ user: 1, period: 1 }, { unique: true });

const Performance = mongoose.model<IPerformance>(
  "Performance",
  performanceSchema,
);
export default Performance;
