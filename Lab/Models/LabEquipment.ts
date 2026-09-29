import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

// 'model' is a reserved property on Mongoose's Document interface (it's the model() method).
// We must Omit it before re-declaring our own 'model: string' field to avoid the conflict.
export interface ILabEquipment extends Omit<Document, 'model'> {
  hospital: mongoose.Types.ObjectId;
  name: string;
  code: string;
  category: string;
  department: mongoose.Types.ObjectId | undefined;
  brand: string;
  model: string;
  quantity: number;
  unit: string;
  purchasePrice: number;
  purchaseDate: Date;
  status: string;
  image?: string;
  isActive: boolean;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const labEquipmentSchema = new Schema<ILabEquipment>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    category: { type: String, required: true },
    department: { type: Schema.Types.ObjectId, ref: "Department" },
    brand: { type: String, required: true },
    model: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    purchasePrice: { type: Number, required: true, min: 0 },
    purchaseDate: { type: Date, required: true },
    status: {
      type: String,
      required: true,
      enum: ["Working", "Under Maintenance", "Repairing", "Out of Service", "Inactive", "Disposed"],
      default: "Working",
    },
    image: { type: String },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Indexes
labEquipmentSchema.index({ hospital: 1, code: 1 }, { unique: true });
labEquipmentSchema.index({ hospital: 1, name: 1 });
labEquipmentSchema.index({ hospital: 1, category: 1 });
labEquipmentSchema.index({ hospital: 1, status: 1 });

labEquipmentSchema.plugin(multiTenancyPlugin, {
  includeGlobal: false,
  requireTenant: true,
});

const LabEquipment = mongoose.model<ILabEquipment>("LabEquipment", labEquipmentSchema);
export default LabEquipment;
