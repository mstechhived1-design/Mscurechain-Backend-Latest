import mongoose, { Schema, Document } from "mongoose";

export interface IRadiologyReport extends Document {
  orderId:        mongoose.Types.ObjectId;
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  technique: string;
  findings: {
    organWise: {
      organ: string;
      finding: string;
    }[];
  };

  impression: string;
  conclusion: string;
  critical:   boolean;

  reportedBy: mongoose.Types.ObjectId;
  reportedAt: Date;
}

const RadiologyReportSchema: Schema = new Schema(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "RadiologyOrder",
      required: true,
      unique: true,
    },
    prescriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Prescription",
      required: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    hospital: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },

    technique: { type: String },
    findings: {
      organWise: [{
        organ: { type: String },
        finding: { type: String },
      }],
    },

    impression: { type: String, required: true },
    conclusion: { type: String, required: true },
    critical:   { type: Boolean, default: false },

    reportedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
RadiologyReportSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IRadiologyReport>("RadiologyReport", RadiologyReportSchema);
