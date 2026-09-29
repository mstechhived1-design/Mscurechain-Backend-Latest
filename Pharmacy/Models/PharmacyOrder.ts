import mongoose, { Schema, Document } from "mongoose";

export interface IPharmacyOrder extends Document {
  patient: mongoose.Types.ObjectId;
  globalPatientId?: mongoose.Types.ObjectId;
  doctor: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  tokenNumber: string;
  prescription: mongoose.Types.ObjectId;
  admission?: mongoose.Types.ObjectId;
  medicines: {
    productId?: string;
    name: string;
    dosage: string;
    freq: any;
    timing?: string;
    route?: string;
    duration: string;
    quantity: string;
    instructions?: string;
    price: number;
    status: "pending" | "dispensed" | "unavailable";
  }[];
  status: "prescribed" | "processing" | "ready" | "completed";
  patientAge?: string;
  patientGender?: string;
  totalAmount: number;
  paymentStatus: "pending" | "paid";
  invoiceId?: mongoose.Types.ObjectId;
  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: mongoose.Types.ObjectId;
  pharmaWarning?: string;
  createdAt: Date;
  updatedAt: Date;
}

const pharmacyOrderSchema = new Schema<IPharmacyOrder>(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    globalPatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    tokenNumber: { type: String },
    prescription: { type: mongoose.Schema.Types.ObjectId, ref: "Prescription" },
    admission: { type: mongoose.Schema.Types.ObjectId, ref: "IPDAdmission" },
    medicines: [
      {
        productId: { type: String, default: null },
        name: String,
        dosage: String,
        freq: Schema.Types.Mixed,
        timing: String,
        route: String,
        duration: String,
        quantity: String,
        instructions: String,
        price: Number,
        status: {
          type: String,
          enum: ["pending", "dispensed", "unavailable"],
          default: "pending",
        },
      },
    ],
    status: {
      type: String,
      enum: ["prescribed", "processing", "ready", "completed"],
      default: "prescribed",
    },
    patientAge: String,
    patientGender: String,
    totalAmount: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid"],
      default: "pending",
    },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    pharmaWarning: { type: String },
  },
  { timestamps: true },
);

pharmacyOrderSchema.index({ globalPatientId: 1, hospital: 1 });
pharmacyOrderSchema.index({ globalPatientId: 1, createdAt: -1 });
pharmacyOrderSchema.index({ hospital: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
pharmacyOrderSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IPharmacyOrder>(
  "PharmacyOrder",
  pharmacyOrderSchema,
);
