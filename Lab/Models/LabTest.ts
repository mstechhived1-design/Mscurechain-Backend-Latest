import mongoose, { Schema } from "mongoose";
import { ILabTest } from "../types/index.js";

const labTestSchema = new Schema<any>(
  {
    // Optional: LabTests are a shared catalog; hospital scoping is optional
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: false,
    },
    testName: { type: String, required: true }, // Using testName as per user request
    name: { type: String }, // Keep for compatibility
    universalTestId: { type: mongoose.Schema.Types.ObjectId, ref: "UniversalLabTest" }, // NEW: Link to Universal Master
    priceReviewRequired: { type: Boolean, default: false }, // NEW: Flag for admin to review auto-imported pricing
    testCode: { type: String, sparse: true }, // Removed global unique: true
    shortName: { type: String }, // Added for display
    code: { type: String }, // Removed unique: true to avoid blocking legacy index issues
    departmentIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
    ],
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department" }, // Keep for compatibility
    testGroupId: { type: mongoose.Schema.Types.ObjectId, ref: "TestGroup" }, // LINK TO TEST GROUP
    isProfile: { type: Boolean, default: false }, // MARK AS PROFILE
    category: { type: String }, // Keep mapping for transition
    price: { type: Number, required: true, min: 0 },
    labPrice: { type: Number, min: 0 }, // Optional discounted price for Lab-to-Lab billing
    sampleType: { type: String, default: "Blood" }, // Default to avoid validation errors
    unit: { type: String },
    methodology: { type: String }, // Consolidated field
    turnaroundTime: { type: String },
    temporalTATCycle: { type: String }, // NEW
    reportFormat: { type: String }, // NEW
    normalRanges: {
      male: { min: Number, max: Number, text: String },
      female: { min: Number, max: Number, text: String },
      child: { min: Number, max: Number, text: String },
      newborn: { min: Number, max: Number, text: String },
      infant: { min: Number, max: Number, text: String }, // Added Infant
      geriatric: { min: Number, max: Number, text: String }, // Added Geriatric
    },
    // Dynamic Result Parameters - Lab staff can define custom fields
    resultParameters: [
      {
        label: { type: String, required: true }, // Field name (e.g., "Hemoglobin", "WBC Count")
        unit: { type: String }, // Unit of measurement (e.g., "g/dL", "cells/µL")
        normalRange: { type: String }, // Normal range text (e.g., "12-16 g/dL")
        normalRanges: {
          male: { min: Number, max: Number, text: String },
          female: { min: Number, max: Number, text: String },
          child: { min: Number, max: Number, text: String },
          newborn: { min: Number, max: Number, text: String },
          infant: { min: Number, max: Number, text: String },
          geriatric: { min: Number, max: Number, text: String },
        },
        remarks: { type: String }, // Additional info or instructions
        example: { type: String }, // Example value to guide entry
        fieldType: { type: String, enum: ["text", "number", "boolean"], default: "text" }, // Input type
        isRequired: { type: Boolean, default: false }, // Whether this field is mandatory
        displayOrder: { type: Number, default: 0 }, // Order in which to display
      },
    ],
    fastingRequired: { type: Boolean, default: false },
    sampleVolume: { type: String },
    reportType: {
      type: String,
      enum: ["numeric", "text", "both"],
      default: "numeric",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Add index for hospital-based queries
labTestSchema// .index({ hospital: 1 }) removed to prevent duplicate index with tenantPlugin;
labTestSchema.index({ hospital: 1, isActive: 1 });
// Compound unique indexes for uniqueness within a hospital
labTestSchema.index({ hospital: 1, testCode: 1 }, { unique: true, sparse: true });
labTestSchema.index({ hospital: 1, testName: 1 }, { unique: true });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
labTestSchema.plugin(multiTenancyPlugin, {
  includeGlobal: true,
  requireTenant: false,
});

const LabTest = mongoose.model<ILabTest>("LabTest", labTestSchema);
export default LabTest;
