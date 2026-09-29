import mongoose, { Schema, Document } from "mongoose";

export interface IPerformanceWeights extends Document {
    hospital: mongoose.Types.ObjectId;
    role: "doctor" | "nurse" | "staff";
    weights: {
        attendance: number;     // e.g. 0.30
        quality: number;        // e.g. 0.25
        activity: number;       // e.g. 0.25
        revenue: number;        // e.g. 0.10  (doctors only)
        taskCompletion: number; // e.g. 0.10  (nurses/staff)
    };
    thresholds: {
        highPerformer: number;  // compositeScore >= this = high performer, default 4.0
        lowAttendance: number;  // attendanceRate < this = risk flag, default 70
        burnoutOvertime: number;// overtime hours > this per month, default 50
        lowRating: number;      // avgRating < this = alert, default 3.0
    };
    updatedBy?: mongoose.Types.ObjectId;
}

const performanceWeightsSchema = new Schema<IPerformanceWeights>(
    {
        hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
        role: {
            type: String,
            enum: ["doctor", "nurse", "staff"],
            required: true,
        },
        weights: {
            attendance: { type: Number, default: 0.30 },
            quality: { type: Number, default: 0.25 },
            activity: { type: Number, default: 0.25 },
            revenue: { type: Number, default: 0.10 },
            taskCompletion: { type: Number, default: 0.10 },
        },
        thresholds: {
            highPerformer: { type: Number, default: 4.0 },
            lowAttendance: { type: Number, default: 70 },
            burnoutOvertime: { type: Number, default: 50 },
            lowRating: { type: Number, default: 3.0 },
        },
        updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true },
);

performanceWeightsSchema.index({ hospital: 1, role: 1 }, { unique: true });

const PerformanceWeights = mongoose.model<IPerformanceWeights>(
    "PerformanceWeights",
    performanceWeightsSchema,
);
export default PerformanceWeights;
