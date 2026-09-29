import mongoose, { Schema } from "mongoose";
import { IBed } from "../types/index.js";

const bedSchema = new Schema<IBed>(
  {
    bedId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    floor: { type: String, required: true },
    room: { type: String, required: true },
    department: { type: String },
    ward: { type: String },
    status: {
      type: String,
      enum: ["Vacant", "Occupied", "Cleaning", "Blocked"],
      default: "Vacant",
    },
    pricePerDay: { type: Number, default: 0 },
    pricePerHalfDay: { type: Number, default: 0 },
    pricePerHour: { type: Number, default: 0 },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
bedSchema.plugin(multiTenancyPlugin);

// Compound unique: same bedId can exist in different hospitals but NOT twice in the same hospital
bedSchema.index({ bedId: 1, hospital: 1 }, { unique: true });
bedSchema.index({ hospital: 1, type: 1 });
bedSchema.index({ hospital: 1, room: 1 });
bedSchema.index({ hospital: 1, status: 1 });

const Bed = mongoose.model<IBed>("Bed", bedSchema);
export default Bed;
