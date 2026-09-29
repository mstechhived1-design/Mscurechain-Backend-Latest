import mongoose, { Schema, Document, Types } from "mongoose";

export interface ILabAuditLog extends Document {
  hospital: Types.ObjectId;
  entity: "LabTest" | "HospitalLabConfig" | "LabPackage" | "LabOrder";
  entityId: Types.ObjectId;
  action: "CREATED" | "UPDATED" | "DELETED" | "IMPORTED";
  oldValue?: any;
  newValue?: any;
  user: Types.ObjectId;
  createdAt: Date;
}

const labAuditLogSchema = new Schema<ILabAuditLog>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    entity: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true },
    oldValue: { type: Schema.Types.Mixed },
    newValue: { type: Schema.Types.Mixed },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

labAuditLogSchema.index({ hospital: 1, entity: 1, action: 1 });
labAuditLogSchema.index({ entityId: 1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
labAuditLogSchema.plugin(multiTenancyPlugin, {
  includeGlobal: false,
  requireTenant: true,
});

const LabAuditLog = mongoose.model<ILabAuditLog>("LabAuditLog", labAuditLogSchema);
export default LabAuditLog;
