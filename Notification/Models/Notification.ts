import mongoose, { Schema } from "mongoose";
import { INotification } from "../types/index.js";

const notificationSchema = new Schema<INotification>({
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,
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
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "senderModel",
  },
  senderModel: {
    type: String,
    enum: ["User", "Patient"],
  },
  type: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
notificationSchema.plugin(multiTenancyPlugin);

notificationSchema// .index({ hospital: 1 }) removed to prevent duplicate index with tenantPlugin;
notificationSchema.index({ hospital: 1, recipient: 1, createdAt: -1 });
notificationSchema.index({ hospital: 1, recipient: 1, isRead: 1 });

notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 172800 });

const Notification = mongoose.model<INotification>(
  "Notification",
  notificationSchema,
);
export default Notification;
