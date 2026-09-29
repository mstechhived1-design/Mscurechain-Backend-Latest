import mongoose, { Schema, Document } from "mongoose";

export interface IAnnouncement extends Document {
  hospital: mongoose.Types.ObjectId;
  author: mongoose.Types.ObjectId;
  title: string;
  content: string;
  priority: "low" | "medium" | "high";
  targetRoles: string[];
  expiryDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const announcementSchema = new Schema<IAnnouncement>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital" }, // Optional: global if null
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    targetRoles: [{ type: String }],
    expiryDate: { type: Date, default: null },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
announcementSchema.plugin(multiTenancyPlugin, { includeGlobal: true });

const Announcement = mongoose.model<IAnnouncement>(
  "Announcement",
  announcementSchema,
);
export default Announcement;
