import mongoose, { Schema } from "mongoose";
import { ILeave } from "../types/index.js";

const leaveSchema = new Schema<ILeave>({
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  reason: {
    type: String,
    required: true,
  },
  leaveType: {
    type: String,
    enum: ["sick", "casual", "emergency", "maternity", "other"],
    default: "sick",
    required: true,
  },
  assignedHelpdesk: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
leaveSchema.plugin(multiTenancyPlugin);

const Leave = mongoose.model<ILeave>("Leave", leaveSchema);
export default Leave;
