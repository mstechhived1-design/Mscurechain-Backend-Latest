import mongoose, { Schema, Document, Types } from "mongoose";

export interface IRange {
  min?: number;
  max?: number;
  text?: string;
}

export interface ITestParameter extends Document {
  testId: Types.ObjectId;
  name: string;
  subTestCode?: string;
  unit?: string;
  normalRange?: string;
  normalRanges: {
    male: IRange;
    female: IRange;
    child: IRange;
    newborn: IRange;
  };
  resultType: string;
  criticalLow?: string | number;
  criticalHigh?: string | number;
  mandatory: boolean;
  displayOrder: number;
  formulaExpression?: string;
  isActive: boolean;
  hospital: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RESULT_TYPES = [
  "NUMBER",
  "TEXT",
  "POSITIVE_NEGATIVE",
  "REACTIVE_NONREACTIVE",
  "PRESENT_ABSENT",
  "DROPDOWN",
  "MULTISELECT",
  "TITRE",
  "CULTURE_RESULT",
  "ORGANISM_RESULT",
  "BOOLEAN",
  "FORMULA",
  "HISTOPATHOLOGY_REPORT",
  "MICROSCOPY_RESULT",
];

const rangeSchema = new Schema(
  {
    min: { type: Number },
    max: { type: Number },
    text: { type: String }, // For display compatibility (e.g. "13-17")
  },
  { _id: false },
);

const testParameterSchema = new Schema<ITestParameter>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: false },
    testId: { type: Schema.Types.ObjectId, ref: "LabTest", required: true },
    name: { type: String, required: true },
    subTestCode: { type: String, sparse: true },
    unit: { type: String },
    normalRange: { type: String }, // Text format e.g. "12-16 g/dL"
    normalRanges: {
      male: { min: Number, max: Number, text: String },
      female: { min: Number, max: Number, text: String },
      child: { min: Number, max: Number, text: String },
      newborn: { min: Number, max: Number, text: String },
      infant: { min: Number, max: Number, text: String }, // Added Infant
      geriatric: { min: Number, max: Number, text: String }, // Added Geriatric
    },
    resultType: {
      type: String,
      enum: RESULT_TYPES,
      default: "TEXT",
    },
    criticalLow: { type: Schema.Types.Mixed },
    criticalHigh: { type: Schema.Types.Mixed },
    mandatory: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 0 },
    formulaExpression: { type: String }, // For FORMULA resultType — future use
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Index for efficient lookups by parent test
testParameterSchema.index({ hospital: 1, testId: 1, displayOrder: 1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
testParameterSchema.plugin(multiTenancyPlugin, {
  includeGlobal: true,
  requireTenant: false,
});

const TestParameter = mongoose.model<ITestParameter>(
  "TestParameter",
  testParameterSchema,
);
export default TestParameter;
