import mongoose, { Schema, Document } from "mongoose";

export interface IMedicineFavorite extends Document {
  doctor: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  name: string; // E.g., 'Paracetamol 650mg'
  genericName?: string;
  dosage: string;
  frequency: any;
  timing?: string;
  route?: string;
  duration: string;
  quantity?: string;
  instructions?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MedicineFavoriteSchema: Schema = new Schema(
  {
    doctor: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    name: { type: String, required: true },
    genericName: { type: String },
    dosage: { type: String, required: true },
    frequency: { type: Schema.Types.Mixed, required: true },
    timing: { type: String },
    route: { type: String },
    duration: { type: String, required: true, default: 'As directed' },
    quantity: { type: String },
    instructions: { type: String },
  },
  {
    timestamps: true,
  }
);

MedicineFavoriteSchema.index({ doctor: 1, name: 1 }, { unique: true });
MedicineFavoriteSchema.index({ hospital: 1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
MedicineFavoriteSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IMedicineFavorite>(
  "MedicineFavorite",
  MedicineFavoriteSchema
);
