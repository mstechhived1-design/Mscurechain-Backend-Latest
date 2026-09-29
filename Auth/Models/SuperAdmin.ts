import mongoose, { Schema } from "mongoose";
import { ISuperAdmin } from "../types/index.js";

const superAdminSchema = new Schema<ISuperAdmin>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    mobile: { type: String },
    password: { type: String, required: true },
    role: { type: String, default: "super-admin" },
    resetPasswordToken: { type: String },
    resetPasswordExpire: { type: Date },
    status: { type: String, enum: ["active", "suspended"], default: "active" },

    // Refresh Tokens for Multi-device Support
    refreshTokens: [
      {
        tokenHash: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
      },
    ],

    // 2FA Fields
    otp: { type: String },
    otpExpiresAt: { type: Date },
    otpAttempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
superAdminSchema.plugin(multiTenancyPlugin, {
  requireTenant: false,
  scoping: false, // SuperAdmin is never scoped
});

const SuperAdmin = mongoose.model<ISuperAdmin>("SuperAdmin", superAdminSchema);
export default SuperAdmin;
