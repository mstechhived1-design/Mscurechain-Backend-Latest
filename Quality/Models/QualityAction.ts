import mongoose, { Schema, Document } from "mongoose";

export interface IQualityAction extends Document {
  indicatorId: mongoose.Types.ObjectId;
  problemDescription: string;
  period: {
    from: Date;
    to: Date;
  };
  actionDescription: string;
  responsibleDepartment: string;
  startDate: Date;
  reviewDate: Date;
  status: "Open" | "In Progress" | "Completed";
  statusHistory: {
    status: string;
    timestamp: Date;
    updatedBy: mongoose.Types.ObjectId;
  }[];
  outcomeSummary?: string;
  measurableResultBefore?: number;
  measurableResultAfter?: number;
  isClosed: boolean;
  hospitalId: mongoose.Types.ObjectId;
}

const QualityActionSchema: Schema = new Schema(
  {
    indicatorId: {
      type: Schema.Types.ObjectId,
      ref: "QualityIndicator",
      required: true,
    },
    problemDescription: {
      type: String,
      required: true,
    },
    period: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },
    actionDescription: {
      type: String,
      required: true,
    },
    responsibleDepartment: {
      type: String,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    reviewDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["Open", "In Progress", "Completed"],
      default: "Open",
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
      },
    ],
    outcomeSummary: {
      type: String,
    },
    measurableResultBefore: {
      type: Number,
    },
    measurableResultAfter: {
      type: Number,
    },
    isClosed: {
      type: Boolean,
      default: false,
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

// ✅ Middleware to prevent updates to closed actions
QualityActionSchema.pre("save", function (next) {
  if (this.isClosed && !this.isModified("isClosed")) {
    const error = new Error("Cannot modify a closed quality action record.");
    return next(error);
  }
  next();
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
QualityActionSchema.plugin(multiTenancyPlugin, { tenantField: "hospitalId" });

export default mongoose.models.QualityAction ||
  mongoose.model<IQualityAction>("QualityAction", QualityActionSchema);
