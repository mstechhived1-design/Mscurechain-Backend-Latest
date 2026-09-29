import mongoose, { Schema, Document, Types } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IIPDDepartment extends Document {
  name: string;
  code?: string;
  description?: string;
  headOfDepartment?: string;
  hospital: Types.ObjectId;
  isActive: boolean;
}

const ipdDepartmentSchema = new Schema<IIPDDepartment>(
  {
    name: { type: String, required: true },
    code: { type: String },
    description: { type: String },
    headOfDepartment: { type: String },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Compound unique indexes: name AND code must each be unique within a hospital
// Same name/code is allowed across DIFFERENT hospitals
ipdDepartmentSchema.index({ name: 1, hospital: 1 }, { unique: true });
ipdDepartmentSchema.index({ code: 1, hospital: 1 }, { unique: true, sparse: true });

// Strict hospital scoping — no includeGlobal, no requireTenant bypass
ipdDepartmentSchema.plugin(multiTenancyPlugin);

const IPDDepartment = mongoose.model<IIPDDepartment>(
  "IPDDepartment",
  ipdDepartmentSchema,
);
export default IPDDepartment;
