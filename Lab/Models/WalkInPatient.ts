import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IWalkInPatient extends Document {
  registrationId: string;
  name: string;
  age: number;
  gender: string;
  mobile: string;
  email?: string;
  address?: string;
  hospital: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const walkInPatientSchema = new Schema<IWalkInPatient>(
  {
    registrationId: {
      type: String,
      required: true,
      unique: true,
    },
    name: { type: String, required: true },
    age: { type: Number, required: true },
    gender: {
      type: String,
      required: true,
      enum: ["Male", "Female", "Other"],
    },
    mobile: {
      type: String,
      required: true,
      validate: {
        validator: function (v: string) {
          return /^[0-9]{10}$/.test(v);
        },
        message: "Mobile number must be 10 digits",
      },
    },
    email: {
      type: String,
      validate: {
        validator: function (v: string) {
          return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: "Invalid email format",
      },
    },
    address: { type: String },
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Auto-generate registration ID
walkInPatientSchema.pre("save", async function (next) {
  if (!this.registrationId) {
    const count = await mongoose.model("WalkInPatient").countDocuments();
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    this.registrationId = `WI${year}${month}${(count + 1).toString().padStart(5, "0")}`;
  }
  next();
});

// Indexes
walkInPatientSchema.index({ mobile: 1 });
walkInPatientSchema.index({ hospital: 1, createdAt: -1 });

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
walkInPatientSchema.plugin(multiTenancyPlugin);

const WalkInPatient = mongoose.model<IWalkInPatient>(
  "WalkInPatient",
  walkInPatientSchema,
);

export default WalkInPatient;
