import mongoose, { Schema, Document } from "mongoose";

export interface ISupplier extends Document {
  name: string;
  phone: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  };
  gstNumber?: string;
  isActive: boolean;
  notes?: string;
  hospital: mongoose.Types.ObjectId;
  pharmacy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const supplierSchema = new Schema<ISupplier>(
  {
    name: {
      type: String,
      required: [true, "Please provide supplier name"],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Please provide phone number"],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: {
        type: String,
        default: "India",
      },
    },
    gstNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      trim: true,
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
supplierSchema.plugin(multiTenancyPlugin);

supplierSchema.index({ name: 1, pharmacy: 1 });
supplierSchema.index({ isActive: 1, name: 1, pharmacy: 1 });

const Supplier = mongoose.model<ISupplier>("Supplier", supplierSchema);

export default Supplier;
