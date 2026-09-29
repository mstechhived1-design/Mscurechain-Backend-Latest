import mongoose, { Schema, Document } from "mongoose";

export interface IPharmacyToken extends Document {
  appointment: mongoose.Types.ObjectId;
  patient: mongoose.Types.ObjectId;
  globalPatientId?: mongoose.Types.ObjectId;
  doctor: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  tokenNumber: string;
  medicines: {
    name: string;
    dosage: string;
    freq: any;
    duration: string;
    quantity: string;
    price: number;
  }[];
  priority: "routine" | "urgent" | "stat";
  status: "pending" | "dispensed" | "completed";
  notes?: string;
  pharmaWarning?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PharmacyTokenSchema: Schema = new Schema(
  {
    appointment: { type: Schema.Types.ObjectId, ref: "Appointment" },
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    doctor: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    tokenNumber: { type: String },
    medicines: [
      {
        name: { type: String, required: true },
        dosage: { type: String },
        freq: Schema.Types.Mixed,
        duration: { type: String },
        quantity: { type: String },
        price: { type: Number },
      },
    ],
    priority: {
      type: String,
      enum: ["routine", "urgent", "stat"],
      default: "routine",
    },
    status: {
      type: String,
      enum: ["pending", "dispensed", "completed"],
      default: "pending",
    },
    notes: { type: String },
    pharmaWarning: { type: String },
  },
  {
    timestamps: true,
  },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
PharmacyTokenSchema.plugin(multiTenancyPlugin);

PharmacyTokenSchema.index({ tokenNumber: 1, hospital: 1 }, { unique: true });
PharmacyTokenSchema.index({ globalPatientId: 1, hospital: 1 });
PharmacyTokenSchema.index({ globalPatientId: 1, createdAt: -1 });

PharmacyTokenSchema.pre("save", async function (next) {
  if (!this.tokenNumber) {
    const count = await mongoose.model("PharmacyToken").countDocuments();
    this.tokenNumber = `PHARMA-${Date.now().toString().slice(-6)}-${count + 1}-${Math.floor(
      Math.random() * 1000,
    )
      .toString()
      .padStart(3, "0")}`;
  }
  next();
});

export default mongoose.model<IPharmacyToken>(
  "PharmacyToken",
  PharmacyTokenSchema,
);
