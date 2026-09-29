import mongoose, { Schema, Document, Types } from "mongoose";

export interface ITransactionReport extends Document {
  patient: Types.ObjectId;
  hospital: Types.ObjectId;
  reportData: any; // JSON containing all charges (doctors, admissions, meds, etc.)
  totals: {
    grandTotal: number;
    totalPaid: number;
    balance: number;
    discount?: number;
  };
  generatedBy: string;
  date: Date;
  isOPD?: boolean;
  isEdited?: boolean;
  editReason?: string;
  editedAt?: Date;
  editedBy?: Types.ObjectId;
}

const transactionReportSchema = new Schema<ITransactionReport>({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Patient",
    required: true,
  },
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,
  },
  reportData: {
    type: Schema.Types.Mixed,
    required: true,
  },
  totals: {
    grandTotal: { type: Number, required: true },
    totalPaid: { type: Number, required: true },
    balance: { type: Number, required: true },
    discount: { type: Number, default: 0 },
  },
  generatedBy: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  isOPD: { type: Boolean },
  isEdited: { type: Boolean, default: false },
  editReason: { type: String },
  editedAt: { type: Date },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
transactionReportSchema.plugin(multiTenancyPlugin);

const TransactionReport = mongoose.model<ITransactionReport>("TransactionReport", transactionReportSchema);
export default TransactionReport;
