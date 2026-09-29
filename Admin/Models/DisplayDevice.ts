import mongoose, { Schema, Document } from "mongoose";

export interface IDisplayDevice extends Document {
  display_id: string;
  pair_code: string;
  hospital: mongoose.Types.ObjectId;
  department?: mongoose.Types.ObjectId;
  assigned_doctors: mongoose.Types.ObjectId[];
  display_name: string;
  announcement_language?: string;
  video_url?: string;
  play_sound?: boolean;
  socket_id?: string;
  status: "online" | "offline";
  last_seen: Date;
}

const displayDeviceSchema = new Schema<IDisplayDevice>(
  {
    display_id: { type: String, required: true, unique: true },
    pair_code: { type: String, required: true, unique: true },
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
    },
    assigned_doctors: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DoctorProfile",
      },
    ],
    display_name: { type: String, required: true },
    announcement_language: { type: String, default: "en-IN" },
    video_url: { type: String },
    play_sound: { type: Boolean, default: false },
    socket_id: { type: String },
    status: { type: String, enum: ["online", "offline"], default: "offline" },
    last_seen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
displayDeviceSchema.plugin(multiTenancyPlugin);

const DisplayDevice = mongoose.model<IDisplayDevice>(
  "DisplayDevice",
  displayDeviceSchema
);

export default DisplayDevice;
