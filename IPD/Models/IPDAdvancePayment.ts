import mongoose, { Schema } from "mongoose";
import { IIPDAdvancePayment } from "../types/index.js";

const ipdAdvancePaymentSchema = new Schema<IIPDAdvancePayment>(
  {
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    admission: {
      type: Schema.Types.ObjectId,
      ref: "IPDAdmission",
      required: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    amount: { type: Number, required: true },
    mode: {
      type: String,
      enum: ["Cash", "Card", "Bank Transfer", "Cheque", "Digital Wallet", "Insurance", "Corporate/Sponsor", "UPI", "Mixed"],
      required: true,
    },
    paymentDetails: {
      cash: { type: Number, default: 0 },
      upi: { type: Number, default: 0 },
      card: { type: Number, default: 0 },
      bankTransfer: { type: Number, default: 0 },
    },
    reference: { type: String },
    transactionType: {
      type: String,
      enum: ["Advance", "Interim Payment", "Refund", "Settlement", "Due Recovery"],
      required: true,
    },
    date: { type: Date, default: Date.now },
    receivedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    transactionId: { type: String, unique: true },
    receiptNumber: { type: String },
    isEdited: { type: Boolean, default: false },
    editReason: { type: String },
    editedAt: { type: Date },
    editedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// 🛡️ Pre-save ID Generation Logic
ipdAdvancePaymentSchema.pre("save", async function (this: any, next) {
  if (this.hospital && (!this.transactionId || (this.transactionType !== "Refund" && !this.receiptNumber))) {
    try {
      const Hospital = mongoose.model("Hospital");
      const hospital = await Hospital.findById(this.hospital).select("name");
      const hospitalName = hospital?.name || "HOSPITAL";

      if (!this.transactionId) {
        const { generateTransactionId } = await import("../../utils/idGenerator.js");
        const typePrefix = this.transactionType === "Refund" ? "REF" : "IPD";
        this.transactionId = await generateTransactionId(this.hospital, hospitalName, typePrefix);
      }

      if (!this.receiptNumber && this.transactionType !== "Refund") {
        const { generateReceiptNumber } = await import("../../utils/idGenerator.js");
        this.receiptNumber = await generateReceiptNumber(this.hospital);
      }
    } catch (err) {
      console.error("Error generating IDs for IPDAdvancePayment:", err);
    }
  }
  next();
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
ipdAdvancePaymentSchema.plugin(multiTenancyPlugin);

ipdAdvancePaymentSchema.index({ globalPatientId: 1, hospital: 1 });
ipdAdvancePaymentSchema.index({ admission: 1, date: -1 });

const IPDAdvancePayment = mongoose.model<IIPDAdvancePayment>(
  "IPDAdvancePayment",
  ipdAdvancePaymentSchema,
);
export default IPDAdvancePayment;
