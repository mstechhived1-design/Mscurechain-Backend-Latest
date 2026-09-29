import mongoose, { Schema, Document } from "mongoose";

export interface ISOP extends Document {
  name: string;
  category:
    | "OPD"
    | "IPD"
    | "Billing"
    | "Infection Control"
    | "Emergency"
    | "HR"
    | "Pharmacy"
    | "Lab"
    | "General";
  version: number;
  fileUrl: string;
  publicId: string;
  resourceType: string;
  accessType: "upload" | "authenticated" | "private";
  fileName: string;
  status: "Active" | "Archived";
  hospital: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  assignedRole: "Staff" | "Doctor" | "Nurse";
  lastUpdated: Date;
  createdAt: Date;
  updatedAt: Date;
}

const sopSchema = new Schema<ISOP>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        "OPD",
        "IPD",
        "Billing",
        "Infection Control",
        "Emergency",
        "HR",
        "Pharmacy",
        "Lab",
        "General",
      ],
      required: true,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    publicId: {
      type: String,
      required: true,
    },
    resourceType: {
      type: String,
      required: true,
      default: "raw",
    },
    accessType: {
      type: String,
      enum: ["upload", "authenticated", "private"],
      required: true,
      default: "upload",
    },
    fileName: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["Active", "Archived"],
      default: "Active",
    },
    hospital: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    assignedRole: {
      type: String,
      enum: ["Staff", "Doctor", "Nurse"],
      required: true,
      default: "Staff",
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
sopSchema.plugin(multiTenancyPlugin);

// Index for ensuring unique active version per name per hospital
// This is handled in the controller logic but index helps for performance and integrity
sopSchema.index({ name: 1, hospital: 1, status: 1 });

const SOP = mongoose.model<ISOP>("SOP", sopSchema);
export default SOP;
