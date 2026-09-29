import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IShift extends Document {
  name: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  hospital: mongoose.Types.ObjectId;
  color: string;
  status: "active" | "inactive";
}

const shiftSchema = new Schema<IShift>(
  {
    name: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    color: { type: String, default: "blue" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true },
);

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
shiftSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IShift>("Shift", shiftSchema);
