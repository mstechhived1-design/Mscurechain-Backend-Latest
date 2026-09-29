import mongoose, { Schema } from "mongoose";
import { IUser } from "../types/index.js";

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      get: function (name: string) {
        if (this && this.role === "doctor" && name) {
          let cleaned = name.trim();
          while (/^(dr|dr\.|dr\s+|dr\.\s+)/i.test(cleaned)) {
            cleaned = cleaned.replace(/^(dr|dr\.|dr\s+|dr\.\s+)/i, "").trim();
          }
          return cleaned ? `Dr. ${cleaned}` : "Doctor";
        }
        return name;
      },
    },
    mobile: { type: String, required: true, unique: true, sparse: true },
    email: { type: String, lowercase: true, sparse: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: [
        "doctor",
        "helpdesk",
        "masterhelpdesk",
        "hospital-admin",
        "lab",
        "staff",
        "pharma-owner",
        "admin",
        "nurse",
        "emergency",
        "patient",
        "hr",
        "ambulance",
      ],
      required: true,
    },

    hospital: { type: Schema.Types.ObjectId, ref: "Hospital" },
    doctorId: { type: String, unique: true, sparse: true },
    age: { type: Number },
    ageUnit: {
      type: String,
      enum: ["Years", "Months", "Days"],
      default: "Years",
    },
    gender: {
      type: String,
      enum: ["male", "Male", "female", "Female", "other", "Other"],
    },
    resetPasswordToken: { type: String },
    resetPasswordExpire: { type: Date },
    status: {
      type: String,
      enum: ["active", "suspended", "inactive"],
      default: "active",
    },
    avatar: { type: String },
    dateOfBirth: { type: Date },
    consentGiven: { type: Boolean, default: false },
    consentTimestamp: { type: Date },

    // Pharmacy / Shop Details directly on User for Frontend Access
    shopName: { type: String },
    address: { type: Schema.Types.Mixed },
    gstin: { type: String },
    licenseNo: { type: String },
    image: { type: String }, // Used for Logo

    // Staff / Discharge Details
    employeeId: { type: String },
    department: { type: String },

    // Pharmacy terms
    pharmacyTerms: { type: [String] },

    // HelpDesk Details
    assignedStaff: { type: Schema.Types.ObjectId, ref: "StaffProfile" },
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
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } },
);

// Pre-save hook to ensure doctor name formatting
userSchema.pre("save", function (next) {
  if (this.role === "doctor" && this.name) {
    let cleaned = this.name.trim();
    cleaned = cleaned.replace(/\s*\.+\s*/g, " ").replace(/\s+/g, " ").trim();
    while (/^(dr|dr\.|dr\s+|dr\.\s+)/i.test(cleaned)) {
      cleaned = cleaned.replace(/^(dr|dr\.|dr\s+|dr\.\s+)/i, "").trim();
    }
    this.name = cleaned ? `Dr. ${cleaned}` : "Doctor";
  }
  next();
});

// Indexes for faster login/lookup
userSchema.index({ role: 1 });
userSchema.index({ hospital: 1, role: 1, status: 1 });
userSchema.index({ hospital: 1, createdAt: -1 });
userSchema.index({ name: "text", email: "text", mobile: "text" });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
userSchema.plugin(multiTenancyPlugin, {
  tenantField: "hospital",
  requireTenant: false, // Users (like Patients or SuperAdmins) may not always be tied to one hospital in a strict hierarchical sense during login
  indexTenant: false, // User model has a custom compound index on hospital
});

const User = mongoose.model<IUser>("User", userSchema);
export default User;
