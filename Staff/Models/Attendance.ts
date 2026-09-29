import mongoose, { Schema } from "mongoose";
import { IAttendance } from "../types/index.js";

const attendanceSchema = new Schema<IAttendance>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    date: { type: Date, required: true },
    checkIn: { type: Date },
    checkOut: { type: Date },
    locationIn: {
      lat: Number,
      lng: Number,
    },
    locationOut: {
      lat: Number,
      lng: Number,
    },
    photoIn: { type: String },
    photoOut: { type: String },
    isAutoClockOut: { type: Boolean, default: false },
    autoClockOutReason: { type: String },
    shiftName: { type: String },
    shiftStart: { type: String },
    shiftEnd: { type: String },
    status: {
      type: String,
      enum: ["present", "absent", "late", "half-day", "on-leave", "off-duty", "auto-clock-out"],
      default: "present",
    },
    isQrVerified: { type: Boolean, default: false },
    notes: { type: String },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
attendanceSchema.plugin(multiTenancyPlugin);

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceSchema.index({ hospital: 1, date: -1, status: 1 });
attendanceSchema.index({ date: -1 });

const Attendance = mongoose.model<IAttendance>("Attendance", attendanceSchema);
export default Attendance;
