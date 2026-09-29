import mongoose, { Schema, Document, Types } from "mongoose";

export interface ITestGroup extends Document {
  name: string;
  departmentId: Types.ObjectId;
  description?: string;
  displayOrder: number;
  isProfile: boolean;
  isActive: boolean;
  hospital: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const testGroupSchema = new Schema<ITestGroup>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: false },
    name: { type: String, required: true },
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "Department",
      required: false,
    },
    description: { type: String },
    displayOrder: { type: Number, default: 0 },
    isProfile: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
testGroupSchema.plugin(multiTenancyPlugin, {
  includeGlobal: true,
  requireTenant: false,
});

const TestGroup = mongoose.model<ITestGroup>("TestGroup", testGroupSchema);
export default TestGroup;
