import mongoose from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

const recruitmentSchema = new mongoose.Schema(
  {
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    department: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    requirements: {
      type: [String],
      default: [],
    },
    numberOfPositions: {
      type: Number,
      default: 1,
    },
    type: {
      type: String,
      enum: ["Full-time", "Part-time", "Contract"],
      default: "Full-time",
    },
    status: {
      type: String,
      enum: [
        "pending_approval",
        "approved",
        "rejected",
        "open",
        "paused",
        "closed",
      ],
      default: "pending_approval",
    },
    applicantsCount: {
      type: Number,
      default: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    rejectionReason: {
      type: String,
    },
    postedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
recruitmentSchema.plugin(multiTenancyPlugin);

const Recruitment = mongoose.model("Recruitment", recruitmentSchema);
export default Recruitment;
