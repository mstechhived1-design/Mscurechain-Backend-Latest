import mongoose, { Schema, Document, Types } from "mongoose";

export interface IUniversalRange {
  min?: number;
  max?: number;
  text?: string;
}

export interface IUniversalTestParameter extends Document {
  universalTestId: Types.ObjectId;
  name: string;
  subTestCode?: string;
  unit?: string;
  normalRange?: string;
  normalRanges: {
    male: IUniversalRange;
    female: IUniversalRange;
    child: IUniversalRange;
    newborn: IUniversalRange;
    infant: IUniversalRange;
    geriatric: IUniversalRange;
  };
  resultType: string;
  criticalLow?: string | number;
  criticalHigh?: string | number;
  mandatory: boolean;
  displayOrder: number;
  formulaExpression?: string;
  isActive: boolean;
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
    text: { type: String },
  },
  { _id: false }
);

const universalTestParameterSchema = new Schema<IUniversalTestParameter>(
  {
    universalTestId: { type: Schema.Types.ObjectId, ref: "UniversalLabTest", required: true },
    name: { type: String, required: true },
    subTestCode: { type: String },
    unit: { type: String },
    normalRange: { type: String },
    normalRanges: {
      male: { min: Number, max: Number, text: String },
      female: { min: Number, max: Number, text: String },
      child: { min: Number, max: Number, text: String },
      newborn: { min: Number, max: Number, text: String },
      infant: { min: Number, max: Number, text: String },
      geriatric: { min: Number, max: Number, text: String },
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
    formulaExpression: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Indexes
universalTestParameterSchema.index({ universalTestId: 1, displayOrder: 1 });

const UniversalTestParameter = mongoose.model<IUniversalTestParameter>(
  "UniversalTestParameter",
  universalTestParameterSchema
);

export default UniversalTestParameter;
