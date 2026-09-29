import mongoose, { Schema, Document } from "mongoose";

export interface IAmbulancePersonnel extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  mobile: string;
  password: string;
  employeeId: string;
  vehicleNumber: string;
  driverLicense?: string;
  status: "active" | "suspended" | "off-duty";
  resetPasswordToken?: string;
  resetPasswordExpire?: Date;
  hospital?: mongoose.Types.ObjectId;
  refreshTokens?: {
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const ambulancePersonnelSchema = new Schema<IAmbulancePersonnel>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    mobile: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    employeeId: { type: String, required: true, unique: true },
    vehicleNumber: { type: String, required: true },
    driverLicense: { type: String },
    hospital: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital" },
    status: {
      type: String,
      enum: ["active", "suspended", "off-duty"],
      default: "active",
    },
    resetPasswordToken: { type: String },
    resetPasswordExpire: { type: Date },

    // Refresh Tokens for Multi-device Support
    refreshTokens: [
      {
        tokenHash: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
      },
    ],
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
ambulancePersonnelSchema.plugin(multiTenancyPlugin, { requireTenant: false });

const AmbulancePersonnel = mongoose.model<IAmbulancePersonnel>(
  "AmbulancePersonnel",
  ambulancePersonnelSchema,
);

export default AmbulancePersonnel;
