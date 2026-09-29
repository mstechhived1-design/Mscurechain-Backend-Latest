import mongoose, { Schema, Document } from "mongoose";

export interface IPharmaAuditLog extends Document {
  action: string;
  userId: mongoose.Types.ObjectId;
  userName: string;
  userEmail: string;
  resourceType: string;
  resourceId?: mongoose.Types.ObjectId;
  details: any;
  ipAddress?: string;
  userAgent?: string;
  hospital: mongoose.Types.ObjectId;
  pharmacy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema<IPharmaAuditLog>(
  {
    action: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true },
    userEmail: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: Schema.Types.ObjectId },
    details: { type: Schema.Types.Mixed },
    ipAddress: String,
    userAgent: String,
    hospital: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      },
    pharmacy: {
      type: Schema.Types.ObjectId,
      ref: "PharmaProfile",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
auditLogSchema.plugin(multiTenancyPlugin);

const PharmaAuditLog = mongoose.model<IPharmaAuditLog>(
  "PharmaAuditLog",
  auditLogSchema,
);

export default PharmaAuditLog;
