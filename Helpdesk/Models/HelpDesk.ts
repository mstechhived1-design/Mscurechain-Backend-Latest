import mongoose, { Schema } from "mongoose";
import { IHelpDesk } from "../types/index.js";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

const helpDeskSchema = new Schema<IHelpDesk>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    mobile: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    password: { type: String, required: true },
    hospital: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital" },
    resetPasswordToken: { type: String },
    resetPasswordExpire: { type: Date },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
    role: { type: String, default: "helpdesk" },
    assignedStaff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
    },
    loginId: { type: String },
    additionalNotes: { type: String },

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

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
helpDeskSchema.plugin(multiTenancyPlugin);

const HelpDesk = mongoose.model<IHelpDesk>("HelpDesk", helpDeskSchema);
export default HelpDesk;
