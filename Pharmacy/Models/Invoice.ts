import mongoose, { Schema, Document } from "mongoose";

export interface IInvoiceItem {
  drug?: mongoose.Types.ObjectId;
  batch?: mongoose.Types.ObjectId;
  batchNo?: string;
  expiryDate?: Date;
  productName: string;
  qty: number;
  freeQty: number;
  unitRate: number;
  mrp?: number;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: number;
  gstPct: number;
  hsnCode?: string;
  amount: number;
  returnedQty?: number;
}

export interface IPharmaInvoice extends Document {
  invoiceNo: string;
  patientName: string;
  patientAddress?: string;
  mrn?: string;
  patientType?: string;
  admissionDate?: Date;
  dischargeDate?: Date;
  roomNo?: string;
  department?: string;
  diagnosis?: string;
  doctorName?: string;
  customerPhone?: string;
  items: IInvoiceItem[];
  mode: "CASH" | "CARD" | "UPI" | "CREDIT" | "MIXED";
  paymentDetails?: {
    cash: number;
    card: number;
    upi: number;
  };
  billType: "TAX_INVOICE" | "RETAIL_INVOICE" | "CASH_MEMO" | "BILL";
  pdfType: "STANDARD" | "COMPACT" | "DETAILED";
  gstin?: string;
  placeOfSupply?: string;
  placeOfSupplyCode?: string;
  isInterState: boolean;
  subTotal: number;
  discountTotal: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  netPayable: number;
  paid: number;
  balance: number;
  status: "PAID" | "PENDING" | "RETURN";
  printed: boolean;
  createdBy: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  pharmacy: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  isEdited?: boolean;
  editReason?: string;
  editedAt?: Date;
  editedBy?: mongoose.Types.ObjectId;
}

const invoiceItemSchema = new Schema<IInvoiceItem>({
  drug: { type: Schema.Types.ObjectId, ref: "Product" },
  batch: { type: Schema.Types.ObjectId, ref: "Batch" },
  batchNo: { type: String, trim: true },
  expiryDate: { type: Date },
  productName: { type: String, required: true },
  qty: { type: Number, required: true, min: 1 },
  freeQty: { type: Number, default: 0 },
  unitRate: { type: Number, required: true },
  mrp: { type: Number },
  discountType: {
    type: String,
    enum: ["PERCENTAGE", "FIXED"],
    default: "PERCENTAGE",
  },
  discountValue: { type: Number, default: 0 },
  gstPct: { type: Number, required: true },
  hsnCode: { type: String, trim: true },
  amount: { type: Number, required: true },
  returnedQty: { type: Number, default: 0 },
});

const invoiceSchema = new Schema<IPharmaInvoice>(
  {
    invoiceNo: { type: String }, // Scoped uniqueness handled by compound index below
    patientName: { type: String, required: true, trim: true },
    patientAddress: { type: String, trim: true },
    mrn: { type: String, trim: true },
    patientType: { type: String, trim: true },
    admissionDate: Date,
    dischargeDate: Date,
    roomNo: { type: String, trim: true },
    department: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    doctorName: { type: String, trim: true },
    customerPhone: { type: String, trim: true },
    items: [invoiceItemSchema],
    mode: {
      type: String,
      enum: ["CASH", "CARD", "UPI", "CREDIT", "MIXED"],
      default: "CASH",
    },
    paymentDetails: {
      cash: { type: Number, default: 0 },
      card: { type: Number, default: 0 },
      upi: { type: Number, default: 0 },
    },
    billType: {
      type: String,
      enum: ["TAX_INVOICE", "RETAIL_INVOICE", "CASH_MEMO", "BILL"],
      default: "TAX_INVOICE",
    },
    pdfType: {
      type: String,
      enum: ["STANDARD", "COMPACT", "DETAILED"],
      default: "STANDARD",
    },
    gstin: { type: String, uppercase: true, trim: true },
    placeOfSupply: { type: String, trim: true },
    placeOfSupplyCode: { type: String, trim: true },
    isInterState: { type: Boolean, default: false },
    subTotal: { type: Number, required: true },
    discountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    netPayable: { type: Number, required: true },
    paid: { type: Number, required: true },
    balance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["PAID", "PENDING", "RETURN"],
      default: "PAID",
    },
    printed: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    hospital: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    pharmacy: {
      type: Schema.Types.ObjectId,
      ref: "PharmaProfile",
      required: true,
      index: true,
    },
    notes: String,
    isEdited: { type: Boolean, default: false },
    editReason: { type: String },
    editedAt: { type: Date },
    editedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
invoiceSchema.plugin(multiTenancyPlugin);

invoiceSchema.index({ invoiceNo: 1, pharmacy: 1 }, { unique: true });
invoiceSchema.index({ patientName: 1, pharmacy: 1 });
invoiceSchema.index({ createdAt: -1, pharmacy: 1 });
invoiceSchema.index({ pharmacy: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ customerPhone: 1 });

const PharmaInvoice = mongoose.model<IPharmaInvoice>(
  "PharmaInvoice",
  invoiceSchema,
);

export default PharmaInvoice;
