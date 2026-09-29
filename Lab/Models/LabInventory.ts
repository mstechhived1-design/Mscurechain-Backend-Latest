import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface ILabInventory extends Document {
  hospital: mongoose.Types.ObjectId;
  name: string;
  code: string;
  category: string;
  unit: string;
  quantity: number;
  purchasePrice: number;
  mrp: number;
  reorderLevel: number;
  image?: string;
  brand?: string;
  batchNumber?: string;
  manufacturingDate?: Date;
  expiryDate?: Date;
  description?: string;
  notes?: string;
  isActive: boolean;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const labInventorySchema = new Schema<ILabInventory>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    category: { type: String, required: true },
    unit: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    purchasePrice: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    reorderLevel: { type: Number, required: true, min: 0 },
    image: { type: String },
    brand: { type: String },
    batchNumber: { type: String },
    manufacturingDate: { type: Date },
    expiryDate: { type: Date },
    description: { type: String },
    notes: { type: String },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Indexes
labInventorySchema.index({ hospital: 1, code: 1 }, { unique: true });
labInventorySchema.index({ hospital: 1, name: 1 });
labInventorySchema.index({ hospital: 1, category: 1 });
labInventorySchema.index({ hospital: 1, expiryDate: 1 });

labInventorySchema.plugin(multiTenancyPlugin, {
  includeGlobal: false,
  requireTenant: true,
});

const LabInventory = mongoose.model<ILabInventory>("LabInventory", labInventorySchema);
export default LabInventory;
