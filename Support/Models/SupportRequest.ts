import mongoose, { Schema } from "mongoose";
import { ISupportRequest } from "../types/index.js";

const supportRequestSchema = new Schema<ISupportRequest>({
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: false, // Email might not be available for all staff
  },
  role: {
    type: String,
    enum: [
      "patient",
      "doctor",
      "hospital-admin",
      "helpdesk",
      "masterhelpdesk",
      "super-admin",
      "staff",
      "nurse",
      "ambulance",
      "lab",
      "pharma-owner",
      "admin",
      "DISCHARGE",
      "emergency",
    ],
    required: true,
  },
  subject: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["feedback", "complaint", "bug", "other"],
    default: "feedback",
  },
  status: {
    type: String,
    enum: ["open", "in-progress", "resolved"],
    default: "open",
  },
  attachments: [
    {
      type: String, // URL of the uploaded file
    },
  ],
  replies: [
    {
      senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      name: { type: String }, // Snapshot of name for UI
      role: { type: String, required: true },
      message: { type: String, required: true },
      attachments: [{ type: String }],
      createdAt: { type: Date, default: Date.now },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
supportRequestSchema.plugin(multiTenancyPlugin);

// Add indexes for hospital-based queries
supportRequestSchema.index({ hospital: 1, status: 1 });
supportRequestSchema.index({ hospital: 1, userId: 1 });

supportRequestSchema.pre("save", function (this: ISupportRequest, next) {
  this.updatedAt = new Date();
  next();
});

const SupportRequest = mongoose.model<ISupportRequest>(
  "SupportRequest",
  supportRequestSchema,
);
export default SupportRequest;
