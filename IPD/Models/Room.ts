import mongoose, { Schema, Document, Types } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IRoom extends Document {
  roomId: string; // Plain identifier like "ROOM-101"
  type: string;
  floor: string;
  department: Types.ObjectId | string;
  hospital: Types.ObjectId;
  isActive: boolean;
}

const roomSchema = new Schema<IRoom>(
  {
    roomId: { type: String, required: true, index: true },
    type: {
      type: String,
      required: true,
    },
    floor: { type: String, required: true },
    department: { type: String },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Compound index to ensure uniqueness within a hospital
roomSchema.index({ roomId: 1, hospital: 1 }, { unique: true });

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
roomSchema.plugin(multiTenancyPlugin);

const Room = mongoose.model<IRoom>("Room", roomSchema);
export default Room;
