import mongoose, { Schema } from "mongoose";
import { IIPDExtraCharge } from "../types/index.js";

const ipdExtraChargeSchema = new Schema<IIPDExtraCharge>(
  {
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    admission: {
      type: Schema.Types.ObjectId,
      ref: "IPDAdmission",
      required: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    category: {
      type: String,
      required: true,
    },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["Active", "Reversed"],
      default: "Active",
    },
    reversalReason: { type: String },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
ipdExtraChargeSchema.plugin(multiTenancyPlugin);

ipdExtraChargeSchema.index({ globalPatientId: 1, hospital: 1 });
ipdExtraChargeSchema.index({ admission: 1, category: 1 });

const IPDExtraCharge = mongoose.model<IIPDExtraCharge>(
  "IPDExtraCharge",
  ipdExtraChargeSchema,
);
export default IPDExtraCharge;
