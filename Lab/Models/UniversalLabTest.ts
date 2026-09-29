import mongoose, { Schema, Document, Types } from "mongoose";

export interface IUniversalLabTest extends Document {
  testCode: string;
  testName: string;
  shortName?: string;
  departmentName: string; // Master tests map to department names globally
  category?: string;
  isProfile: boolean;
  resultType: string;
  packageTests?: Types.ObjectId[]; // If it's a package, tests included
  suggestedPrice: number;
  sampleType: string;
  sampleVolume?: string;
  containerType?: string;
  methodology?: string;
  turnaroundTime?: string;
  fastingRequired: boolean;
  reportFormat?: string;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const universalLabTestSchema = new Schema<IUniversalLabTest>(
  {
    testCode: { type: String, required: true, unique: true },
    testName: { type: String, required: true },
    shortName: { type: String },
    departmentName: { type: String, required: true },
    category: { type: String },
    isProfile: { type: Boolean, default: false },
    resultType: { type: String, enum: ['numeric', 'text', 'boolean', 'multiple'], default: 'numeric' },
    packageTests: [{ type: Schema.Types.ObjectId, ref: "UniversalLabTest" }],
    suggestedPrice: { type: Number, required: true, min: 0 },
    sampleType: { type: String, default: "Blood" },
    sampleVolume: { type: String },
    containerType: { type: String },
    methodology: { type: String },
    turnaroundTime: { type: String },
    fastingRequired: { type: Boolean, default: false },
    reportFormat: { type: String },
    isActive: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Indexes
universalLabTestSchema.index({ testName: 1 });
universalLabTestSchema.index({ departmentName: 1 });
universalLabTestSchema.index({ isActive: 1 });
// Add a text index for fast searching during auto-import
universalLabTestSchema.index({ testName: "text", testCode: "text", shortName: "text" });

const UniversalLabTest = mongoose.model<IUniversalLabTest>(
  "UniversalLabTest",
  universalLabTestSchema
);

export default UniversalLabTest;
