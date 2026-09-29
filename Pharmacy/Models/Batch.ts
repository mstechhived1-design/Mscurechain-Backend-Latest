import mongoose, { Schema, Document } from "mongoose";

export interface IBatch extends Document {
  product: mongoose.Types.ObjectId;
  batchNo: string;
  expiry: Date;
  qtyReceived: number;
  qtySold: number;
  unitCost: number;
  unitGst: number;
  supplier: mongoose.Types.ObjectId;
  invoiceNo?: string;
  grnDate: Date;
  hospital: mongoose.Types.ObjectId;
  pharmacy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const batchSchema = new Schema<IBatch>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    batchNo: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    expiry: {
      type: Date,
      required: true,
    },
    qtyReceived: {
      type: Number,
      required: true,
      min: 0,
    },
    qtySold: {
      type: Number,
      default: 0,
      min: 0,
    },
    unitCost: {
      type: Number,
      required: true,
    },
    unitGst: {
      type: Number,
      default: 0,
    },
    supplier: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    invoiceNo: {
      type: String,
    },
    grnDate: {
      type: Date,
      default: Date.now,
    },
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
  },
  {
    timestamps: true,
  },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
batchSchema.plugin(multiTenancyPlugin);

// Performance index for querying batches by product, expiry, and GRN date
batchSchema.index({ product: 1, expiry: 1, grnDate: 1 });

// Uniqueness constraint: no duplicate batchNo for the same product within the same pharmacy
// Scoped per pharmacy (multi-tenant) to allow the same batch number across different hospitals
batchSchema.index(
  { product: 1, batchNo: 1, pharmacy: 1 },
  {
    unique: true,
    name: "idx_batch_product_batchno_pharmacy_unique",
    background: true,
  }
);

const Batch = mongoose.model<IBatch>("Batch", batchSchema);

export default Batch;
