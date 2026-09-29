import mongoose, { Schema } from "mongoose";
import { IIPDAdmission } from "../types/index.js";

const ipdAdmissionSchema = new Schema<IIPDAdmission>(
  {
    admissionId: { type: String, required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    primaryDoctor: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    admissionDate: { type: Date, default: Date.now },
    dischargeDate: { type: Date },
    admissionType: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["Active", "Discharged", "Discharge Initiated"],
      default: "Active",
    },
    diet: { type: String },
    clinicalNotes: { type: String },
    reason: { type: String }, // Primary symptoms/reason for admission
    vitals: {
      height: { type: String },
      weight: { type: String },
      bloodPressure: { type: String },
      temperature: { type: String },
      pulse: { type: String },
      spO2: { type: String },
      respiratoryRate: { type: String },
      glucose: { type: String },
      glucoseType: { type: String },
      status: {
        type: String,
        enum: ["Stable", "Warning", "Critical"],
        default: "Stable",
      },
      condition: { type: String },
      notes: { type: String },
      lastVitalsRecordedAt: { type: Date },
      nextVitalsDue: { type: Date },
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },

    // Billing Fields
    amount: { type: Number, default: 0 },
    totalBilledAmount: { type: Number, default: 0 },
    advancePaid: { type: Number, default: 0 },
    settlementPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },
    discountDetails: {
      amount: { type: Number, default: 0 },
      reason: { type: String },
      approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    isBillLocked: { type: Boolean, default: false },
    billLockedAt: { type: Date },
    billLockedBy: { type: Schema.Types.ObjectId, ref: "User" },

    paymentMethod: { type: String, default: "cash" },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "not_required"],
      default: "pending",
    },
    pharmacyClearanceStatus: {
      type: String,
      enum: ["NOT_REQUIRED", "PENDING", "CLEARED"],
      default: "NOT_REQUIRED",
    },
    dischargeRequested: { type: Boolean, default: false },
    dischargeRequestedAt: { type: Date },
    dischargeRequestedBy: { type: Schema.Types.ObjectId, ref: "User" },
    transferRequested: { type: Boolean, default: false },
    transferRequestedAt: { type: Date },
    transferRequestedBy: { type: Schema.Types.ObjectId, ref: "User" },
    transferInstructions: {
      ward: { type: String },
      room: { type: String },
      bed: { type: String },
      notes: { type: String },
    },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
ipdAdmissionSchema.plugin(multiTenancyPlugin);

// Compound indexes for faster lookups during appointment filtering and dashboard views
ipdAdmissionSchema.index({ patient: 1, hospital: 1, status: 1 });
ipdAdmissionSchema.index({ globalPatientId: 1, hospital: 1 });
ipdAdmissionSchema.index({ globalPatientId: 1, status: 1 });
ipdAdmissionSchema.index({ hospital: 1, status: 1 }); // NEW: Optimized for hospital-wide active checks
ipdAdmissionSchema.index({ status: 1 });
ipdAdmissionSchema.index({ admissionDate: -1 });

const IPDAdmission = mongoose.model<IIPDAdmission>(
  "IPDAdmission",
  ipdAdmissionSchema,
);
export default IPDAdmission;
