import mongoose, { Schema } from "mongoose";
import { IVitalsAlert } from "../types/index.js";

const vitalsAlertSchema = new Schema<IVitalsAlert>(
  {
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    admission: {
      type: Schema.Types.ObjectId,
      ref: "IPDAdmission",
      required: true,
    },
    vitalsRecord: {
      type: Schema.Types.ObjectId,
      ref: "VitalsRecord",
      required: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    assignedDoctor: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    severity: { type: String, enum: ["Warning", "Critical"], required: true },
    vitalName: { type: String, required: true },
    value: { type: Number, required: true },
    thresholdValue: { type: Number, required: true },
    status: {
      type: String,
      enum: ["Active", "Acknowledged", "Resolved"],
      default: "Active",
      required: true,
    },
    isEscalated: { type: Boolean, default: false },
    auditLog: [
      {
        action: { type: String, required: true },
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        timestamp: { type: Date, default: Date.now },
        notes: { type: String },
      },
    ],
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
vitalsAlertSchema.plugin(multiTenancyPlugin);

vitalsAlertSchema.index({ globalPatientId: 1, hospital: 1 });
vitalsAlertSchema.index({ admission: 1, status: 1 });

const VitalsAlert = mongoose.model<IVitalsAlert>(
  "VitalsAlert",
  vitalsAlertSchema,
);
export default VitalsAlert;
