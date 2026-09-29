import mongoose, { Schema, Document } from "mongoose";

export interface IDepartment extends Document {
  hospital: mongoose.Types.ObjectId;
  name: string;
  code?: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const departmentSchema = new Schema<IDepartment>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    name: { type: String, required: true }, // Removed global unique: true for multi-tenancy
    code: { type: String },
    description: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Add index for hospital-based queries
departmentSchema; // .index({ hospital: 1 }) removed to prevent duplicate index with tenantPlugin;
// Compound unique index: Departments must be unique ONLY within a specific hospital
departmentSchema.index({ hospital: 1, name: 1 }, { unique: true });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
departmentSchema.plugin(multiTenancyPlugin, {
  includeGlobal: true,
  requireTenant: false,
});

const Department = mongoose.model<IDepartment>("Department", departmentSchema);
export default Department;