import mongoose, { Schema } from "mongoose";
import { IMessage } from "../types/index.js";

const messageSchema = new Schema<IMessage>(
  {
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "senderModel",
      required: true,
    },
    senderModel: {
      type: String,
      required: true,
      enum: ["User", "Patient"],
      default: "User",
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "recipientModel",
      required: true,
    },
    recipientModel: {
      type: String,
      required: true,
      enum: ["User", "Patient"],
      default: "User",
    },
    content: {
      type: String,
      default: "",
    },
    type: {
      type: String,
      enum: ["text", "image", "file"],
      default: "text",
    },
    fileUrl: {
      type: String, // Cloudinary URL for images/files
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

// Index for faster queries
messageSchema.index({ sender: 1, recipient: 1, timestamp: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
messageSchema.plugin(multiTenancyPlugin);

const Message = mongoose.model<IMessage>("Message", messageSchema);
export default Message;
