import mongoose, { Schema, Document } from "mongoose";

export interface ILabSettings extends Document {
  hospital: mongoose.Types.ObjectId;
  name: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  logo?: string;
  gstin?: string;
  website?: string;
  footerText?: string;
  labTerms?: string[];
  updatedAt: Date;
}

const LabSettingsSchema: Schema = new Schema(
  {
    // Optional: allows global default settings without a hospital
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: false },
    name: { type: String, required: true, default: "My Lab" },
    tagline: { type: String },
    address: { type: String },
    phone: { type: String },
    email: { type: String },
    logo: { type: String }, // URL or Base64
    gstin: { type: String },
    website: { type: String },
    footerText: { type: String },
    labTerms: { type: [String], default: [] },
  },
  {
    timestamps: true,
  },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
LabSettingsSchema.plugin(multiTenancyPlugin, { indexTenant: false });

// Sparse unique index: allows multiple docs without hospital, but unique per hospital
LabSettingsSchema.index({ hospital: 1 }, { unique: true, sparse: true });

export default mongoose.model<ILabSettings>("LabSettings", LabSettingsSchema);
