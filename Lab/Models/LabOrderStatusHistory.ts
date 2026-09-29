import mongoose, { Schema, Document, Types } from "mongoose";

export interface ILabOrderStatusHistory extends Document {
  labOrderId: Types.ObjectId;
  hospital: Types.ObjectId;
  status: string; // Ordered, Collected, Received, Processing, Verified, Approved, Delivered
  changedBy: Types.ObjectId; // User ID
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const labOrderStatusHistorySchema = new Schema<ILabOrderStatusHistory>(
  {
    labOrderId: { type: Schema.Types.ObjectId, ref: "LabOrder", required: true },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    status: { type: String, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    remarks: { type: String },
  },
  { timestamps: true }
);

labOrderStatusHistorySchema.index({ labOrderId: 1, createdAt: 1 });
labOrderStatusHistorySchema.index({ hospital: 1, labOrderId: 1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
labOrderStatusHistorySchema.plugin(multiTenancyPlugin, {
  includeGlobal: false,
  requireTenant: true,
});

const LabOrderStatusHistory = mongoose.model<ILabOrderStatusHistory>(
  "LabOrderStatusHistory",
  labOrderStatusHistorySchema
);

export default LabOrderStatusHistory;
