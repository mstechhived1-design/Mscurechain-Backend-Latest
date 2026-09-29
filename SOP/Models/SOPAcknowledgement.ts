import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface ISOPAcknowledgement extends Document {
  sopId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  hospitalId: mongoose.Types.ObjectId;
  acknowledgedAt: Date;
}

const sopAcknowledgementSchema = new Schema<ISOPAcknowledgement>(
  {
    sopId: {
      type: Schema.Types.ObjectId,
      ref: "SOP",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    acknowledgedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

sopAcknowledgementSchema.plugin(multiTenancyPlugin, {
  tenantField: "hospitalId",
});

// Ensure a user can acknowledge an SOP version only once
sopAcknowledgementSchema.index({ sopId: 1, userId: 1 }, { unique: true });

const SOPAcknowledgement = mongoose.model<ISOPAcknowledgement>(
  "SOPAcknowledgement",
  sopAcknowledgementSchema,
);
export default SOPAcknowledgement;
