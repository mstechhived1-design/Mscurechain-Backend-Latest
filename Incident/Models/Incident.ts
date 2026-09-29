import mongoose, { Schema } from "mongoose";
import { IIncident } from "../types/index.js";

const incidentSchema = new Schema<IIncident>({
  incidentId: {
    type: String,
    required: true,
  },
  incidentDate: {
    type: Date,
    required: true,
    validate: {
      validator: function (value: Date) {
        const now = new Date();
        const futureThreshold = new Date(now.getTime() + 60000); // 1 minute tolerance
        return value <= futureThreshold;
      },
      message: "Incident date cannot be in the future",
    },
  },
  hospital: {
    type: Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,
  },
  department: {
    type: String,
    // enum: ['OPD', 'IPD', 'ICU', 'OT', 'Pharmacy', 'Lab'], // Removed to allow custom departments
    required: true,
  },
  incidentType: {
    type: String,
    // Removed enum to allow custom categories
    required: true,
  },
  severity: {
    type: String,
    enum: ["Low", "Medium", "High"],
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  reportedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  // Conditional Fields
  patientFallDetails: {
    patientName: { type: String },
    mrnNumber: { type: String },
    bedNumber: { type: String },
    roomNumber: { type: String },
  },
  equipmentFailureDetails: {
    equipmentName: { type: String },
    causeOfFailure: { type: String },
  },
  medicationErrorDetails: {
    prescriptionOrDrugName: { type: String },
  },

  // Attachments (photos/images uploaded with incident)
  attachments: [
    {
      url: { type: String, required: true },
      publicId: { type: String, required: true },
      fileName: { type: String },
    },
  ],

  status: {
    type: String,
    enum: ["OPEN", "IN REVIEW", "CLOSED"],
    default: "OPEN",
  },
  adminResponse: {
    adminId: { type: Schema.Types.ObjectId, ref: "User" },
    message: { type: String },
    actionTaken: { type: String },
    respondedAt: { type: Date },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
incidentSchema.plugin(multiTenancyPlugin);

// Add index for hospital-based queries
incidentSchema.index({ hospital: 1, status: 1 });

incidentSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

const Incident = mongoose.model<IIncident>("Incident", incidentSchema);
export default Incident;
