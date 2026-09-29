import mongoose, { Schema } from "mongoose";
import { IBedOccupancy } from "../types/index.js";

const bedOccupancySchema = new Schema<IBedOccupancy>(
  {
    bed: { type: Schema.Types.ObjectId, ref: "Bed", required: true },
    admission: {
      type: Schema.Types.ObjectId,
      ref: "IPDAdmission",
      required: true,
    },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    dailyRateAtTime: { type: Number, default: 0 },
    halfDayRateAtTime: { type: Number, default: 0 },
    hourlyRateAtTime: { type: Number, default: 0 },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
bedOccupancySchema.plugin(multiTenancyPlugin);

const BedOccupancy = mongoose.model<IBedOccupancy>(
  "BedOccupancy",
  bedOccupancySchema,
);
export default BedOccupancy;
