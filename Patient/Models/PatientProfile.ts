import mongoose, { Schema } from "mongoose";

import { IPatientProfile } from "../types/index.js";

const patientProfileSchema = new Schema<IPatientProfile>(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    mrn: { type: String },
    honorific: { type: String },
    lastVisit: { type: Date },
    medicalHistory: { type: String },
    contactNumber: { type: String },
    emergencyContactEmail: { type: String },
    emergencyContactName: { type: String },
    emergencyContactPhone: { type: String },
    emergencyContactRelation: { type: String },
    GuardianName: { type: String },
    GuardianRelation: { type: String },
    GuardianMobile: { type: String },
    doctorReference: { type: String },

    dob: { type: Date },
    gender: { type: String, enum: ["male", "female", "other"] },
    address: { type: String },
    alternateNumber: { type: String },
    conditions: { type: String, default: "None" },
    allergies: { type: String, default: "None" },
    medications: { type: String, default: "None" },
    height: { type: String },
    weight: { type: String },
    bloodPressure: { type: String },
    temperature: { type: String },
    pulse: { type: String },
    spO2: { type: String },
    glucose: { type: String },
    glucoseType: { type: String },
    sugar: { type: String },
    maritalStatus: {
      type: String,
      enum: ["Single", "Married", "Divorced", "Widowed"],
    },
    bloodGroup: {
      type: String,
      enum: ["Unknown", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },
    condition: { type: String },
    notes: { type: String },
    bio: { type: String, maxlength: 150, default: "" },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
patientProfileSchema.plugin(multiTenancyPlugin, {
  tenantField: "hospital",
  includeGlobal: true, // Allow fetching profiles across hospitals for the patient portal
  requireTenant: false, // Patient profiles can be created without strictly being locked if needed, though they usually have a hospital. But for reading, we want flexibility.
});

patientProfileSchema.virtual("age").get(function (this: IPatientProfile) {
  if (!this.dob) return null;
  const ageMs = Date.now() - this.dob.getTime();
  return Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
});

patientProfileSchema.set("toJSON", { virtuals: true });
patientProfileSchema.set("toObject", { virtuals: true });

patientProfileSchema.index({ user: 1 });
patientProfileSchema.index({ mrn: 1 });

const PatientProfile = mongoose.model<IPatientProfile>(
  "PatientProfile",
  patientProfileSchema,
);
export default PatientProfile;
