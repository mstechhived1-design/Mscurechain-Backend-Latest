import mongoose, { Schema, Document } from "mongoose";

export interface IPharmaProfile extends Document {
  user: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  businessName: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  logoUrl?: string;
  invoicePrefix: string;
  lowStockThreshold: number;
  qualificationDetails?: {
    qualifications: string[];
  };
  documents?: {
    degreeCertificate?: { url: string; publicId: string };
    registrationCertificate?: { url: string; publicId: string };
  };
  pharmacyTerms?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const pharmaProfileSchema = new Schema<IPharmaProfile>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    hospital: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    businessName: {
      type: String,
      required: true,
    },
    address: String,
    city: String,
    state: String,
    pincode: String,
    phone: String,
    email: String,
    gstin: {
      type: String,
      uppercase: true,
      trim: true,
    },
    logoUrl: String,
    invoicePrefix: {
      type: String,
      default: "PH",
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
    },
    qualificationDetails: {
      qualifications: [{ type: String }],
    },
    documents: {
      degreeCertificate: { url: String, publicId: String },
      registrationCertificate: { url: String, publicId: String },
    },
    pharmacyTerms: [{ type: String }],
  },
  {
    timestamps: true,
  },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
pharmaProfileSchema.plugin(multiTenancyPlugin);

pharmaProfileSchema// .index({ hospital: 1 }) removed to prevent duplicate index with tenantPlugin;

const PharmaProfile = mongoose.model<IPharmaProfile>(
  "PharmaProfile",
  pharmaProfileSchema,
);

export default PharmaProfile;
