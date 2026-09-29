import mongoose, { Schema, Document, Types } from "mongoose";
import { generateTransactionId, generateReceiptNumber, getHospitalCode } from "../../utils/idGenerator.js";
import Hospital from "../../Hospital/Models/Hospital.js";

export interface ITransaction extends Document {
  user: Types.ObjectId;
  userModel: "User" | "Patient" | "SuperAdmin";
  hospital: Types.ObjectId;
  subtotal?: number;
  discountAmount?: number;
  discountReason?: string;
  amount: number;
  type: string;
  status: "pending" | "completed" | "failed";
  referenceId: Types.ObjectId; // E.g., LabOrder ID
  date: Date;
  paymentMode?: "cash" | "upi" | "card" | "mixed" | "other";
  paymentDetails?: {
    cash?: number;
    upi?: number;
    card?: number;
    bankTransfer?: number;
  };
  receiptNumber?: string;
  transactionId?: string;
  invoiceNumber?: string;
  paidAmount?: number;
  balance?: number;
  isEdited?: boolean;
  editReason?: string;
  editedAt?: Date;
  editedBy?: Types.ObjectId;
  patientType?: "opd" | "ipd" | "lab";
  originalPatientName?: string;
  refDoctor?: string;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "userModel",
    required: true,
  },
  userModel: {
    type: String,
    required: true,
    enum: ["User", "Patient", "SuperAdmin"],
    default: "User",
  },
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,
  },
  subtotal: { type: Number },
  discountAmount: { type: Number, default: 0 },
  discountReason: { type: String },
  amount: { type: Number, required: true },
  type: { type: String, required: true }, // 'lab_test', 'appointment', etc.
  status: {
    type: String,
    enum: ["pending", "completed", "failed"],
    default: "pending",
  },
  referenceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: Date, default: Date.now },
  paymentMode: {
    type: String,
    enum: ["cash", "upi", "card", "mixed", "other"],
  },
  paymentDetails: {
    cash: { type: Number, default: 0 },
    upi: { type: Number, default: 0 },
    card: { type: Number, default: 0 },
    bankTransfer: { type: Number, default: 0 },
  },
  receiptNumber: { type: String },
  transactionId: { type: String },
  invoiceNumber: { type: String },
  paidAmount: { type: Number },
  balance: { type: Number },
  isEdited: { type: Boolean, default: false },
  editReason: { type: String },
  editedAt: { type: Date },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  patientType: { type: String, enum: ["opd", "ipd", "lab"] },
  originalPatientName: { type: String },
  refDoctor: { type: String },
}, { timestamps: true });

transactionSchema.pre<ITransaction>("save", async function (next) {
  if (this.hospital && (!this.transactionId || !this.receiptNumber)) {
    try {
      const hospital = await Hospital.findById(this.hospital).select("name");
      const hospitalName = hospital?.name || "HOSPITAL";

      if (!this.transactionId) {
        const typeMap: any = {
          appointment_booking: "APT",
          ipd_advance: "IPD",
          ipd_settlement: "IPD",
          ipd_refund: "IPD",
          pharmacy: "OPD",
          lab_test: "OPD",
          package: "PKG",
        };
        const typePrefix = typeMap[this.type] || "GEN";
        this.transactionId = await generateTransactionId(this.hospital, hospitalName, typePrefix as any);
      }

      if (!this.receiptNumber && this.status === "completed") {
        this.receiptNumber = await generateReceiptNumber(this.hospital);
      }
      
      // Keep legacy invoiceNumber sync if needed, or point it to the new IDs
      if (!this.invoiceNumber) {
        this.invoiceNumber = this.receiptNumber || this.transactionId;
      }
    } catch (err) {
      console.error("Error in Transaction pre-save ID generation:", err);
    }
  }
  next();
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
transactionSchema.plugin(multiTenancyPlugin);

// Financial reporting indexes
transactionSchema.index({ date: -1 });
transactionSchema.index({ type: 1, status: 1 });
transactionSchema.index({ user: 1, date: -1 });
transactionSchema.index({ referenceId: 1 });
transactionSchema.index({ hospital: 1, date: -1 });

const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  transactionSchema,
);
export default Transaction;
