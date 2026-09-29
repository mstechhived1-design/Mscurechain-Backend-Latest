import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPatientHospitalMap extends Document {
  globalPatientId: Types.ObjectId;
  tenantId: Types.ObjectId;
  hospitalPatientId?: Types.ObjectId; // For legacy migration support
  registeredAt: Date;
  consentStatus: {
    dataSharing: boolean;
    marketing: boolean;
    research: boolean;
    consentGivenAt: Date;
    consentRevokedAt?: Date;
  };
  status: "active" | "revoked" | "pending";
  primary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PatientHospitalMapSchema: Schema = new Schema(
  {
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    hospitalPatientId: {
      type: Schema.Types.ObjectId,
    },
    registeredAt: {
      type: Date,
      default: Date.now,
    },
    consentStatus: {
      dataSharing: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false },
      research: { type: Boolean, default: false },
      consentGivenAt: { type: Date, default: Date.now },
      consentRevokedAt: { type: Date },
    },
    status: {
      type: String,
      enum: ["active", "revoked", "pending"],
      default: "active",
    },
    primary: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for fast lookup
PatientHospitalMapSchema.index({ globalPatientId: 1 });
PatientHospitalMapSchema.index({ tenantId: 1 });
PatientHospitalMapSchema.index(
  { globalPatientId: 1, tenantId: 1 },
  { unique: true },
);

// Multi-tenancy plugin is NOT applied here because this is a cross-tenant mapping table
// But we still need to be careful with access control

export default mongoose.model<IPatientHospitalMap>(
  "PatientHospitalMap",
  PatientHospitalMapSchema,
);
