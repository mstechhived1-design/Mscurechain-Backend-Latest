import mongoose, { Schema, Document, Types } from "mongoose";

export interface ILabPackage extends Document {
  hospital: Types.ObjectId;
  name: string;
  description?: string;
  packagePrice: number;
  tests: Types.ObjectId[]; // Array of LabTest IDs
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const labPackageSchema = new Schema<ILabPackage>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    name: { type: String, required: true },
    description: { type: String },
    packagePrice: { type: Number, required: true, min: 0 },
    tests: [{ type: Schema.Types.ObjectId, ref: "LabTest" }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

labPackageSchema.index({ hospital: 1, name: 1 }, { unique: true });
labPackageSchema.index({ hospital: 1, isActive: 1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
labPackageSchema.plugin(multiTenancyPlugin, {
  includeGlobal: false,
  requireTenant: true,
});

const LabPackage = mongoose.model<ILabPackage>("LabPackage", labPackageSchema);
export default LabPackage;
