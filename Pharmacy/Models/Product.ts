import mongoose, { Schema, Document } from "mongoose";

export interface IProduct extends Document {
  sku: string;
  name: string;
  generic: string;
  brand: string;
  form: string;
  strength: string;
  schedule: "H" | "H1" | "X" | "OTC";
  gstPercent: number;
  hsnCode?: string;
  batchNumber?: string;
  expiryDate?: Date;
  mrp: number;
  unitCost: number;
  unitsPerPack: number;
  barcode?: string;
  minStock: number;
  maxStock?: number;
  stock: number;
  isActive: boolean;
  supplier?: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  pharmacy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    sku: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
    },
    generic: {
      type: String,
      required: true,
      index: true,
    },
    brand: {
      type: String,
      required: true,
      index: true,
    },
    form: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    strength: {
      type: String,
      required: true,
    },
    schedule: {
      type: String,
      enum: ["H", "H1", "X", "OTC"],
      default: "OTC",
    },
    gstPercent: {
      type: Number,
      enum: [0, 5, 12, 18, 28],
      default: 12,
    },
    hsnCode: {
      type: String,
      trim: true,
      index: true,
    },
    batchNumber: {
      type: String,
      trim: true,
    },
    expiryDate: {
      type: Date,
    },
    mrp: {
      type: Number,
      required: true,
    },
    unitCost: {
      type: Number,
      default: 0,
    },
    unitsPerPack: {
      type: Number,
      default: 1,
    },
    barcode: {
      type: String,
      index: true,
    },
    minStock: {
      type: Number,
      default: 10,
    },
    maxStock: {
      type: Number,
    },
    stock: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    supplier: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      index: true,
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

productSchema.index({ isActive: 1, brand: 1, pharmacy: 1 });
productSchema.index({ sku: 1, pharmacy: 1 }, { unique: true });
productSchema.index({
  name: "text",
  brand: "text",
  generic: "text",
  sku: "text",
});
productSchema.index({ pharmacy: 1, stock: 1 });
productSchema.index({ pharmacy: 1, expiryDate: 1 });

productSchema.pre("save", function (next) {
  if (!this.name) {
    this.name = `${this.brand} ${this.strength} ${this.form}`;
  }
  next();
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
productSchema.plugin(multiTenancyPlugin);

const Product = mongoose.model<IProduct>("Product", productSchema);

export default Product;
