import mongoose, { Schema } from "mongoose";
import { IPatient } from "../../Auth/types/index.js";

const patientSchema = new Schema<IPatient>(
  {
    name: { type: String, required: true },
    email: { type: String, sparse: true, lowercase: true },
    mobile: { type: String, required: true },
    password: { type: String },
    role: { type: String, default: "patient" },
    hospitals: [{ type: Schema.Types.ObjectId, ref: "Hospital" }],
    resetPasswordToken: { type: String },
    resetPasswordExpire: { type: Date },
    status: {
      type: String,
      enum: ["active", "suspended", "inactive"],
      default: "active",
    },
    honorific: { type: String },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other", "male", "female", "other", ""],
    },
    age: { type: Number },
    ageUnit: { type: String, enum: ["Years", "Months", "Days"] },
    dateOfBirth: { type: Date },
    
    // Global Clinical Data
    height: { type: Number },
    weight: { type: Number },
    bloodGroup: { type: String },
    address: { type: String },
    allergies: { type: String },
    conditions: { type: String },

    // Global Emergency Information
    emergencyContactName: { type: String },
    emergencyContactPhone: { type: String },
    emergencyContactRelation: { type: String },

    // Refresh Tokens for Multi-device Support
    refreshTokens: [
      {
        tokenHash: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
      },
    ],
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
patientSchema.plugin(multiTenancyPlugin, {
  tenantField: "hospitals",
  includeGlobal: true, // Patients can exist globally or be associated with multiple hospitals implicitly via profiles
  requireTenant: false, // A patient is a global entity essentially
  scoping: false, // Disables automatic query scoping for this model
});

const Patient = mongoose.model<IPatient>("Patient", patientSchema);
export default Patient;
