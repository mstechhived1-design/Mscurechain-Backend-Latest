import mongoose, { Schema } from "mongoose";
import { IReport } from "../types/index.js";

const reportSchema = new Schema<IReport>({
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Appointment",
    required: false,
  },
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false, // Can be null if system generated or uploaded by lab
  },
  name: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true, // e.g., "X-Ray", "Blood Test", "Prescription PDF"
  },
  url: {
    type: String,
    required: true,
  },
  public_id: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  generatedBy: {
    type: String,
    enum: ["doctor", "system", "lab"],
    default: "doctor",
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
reportSchema.plugin(multiTenancyPlugin);

const Report = mongoose.model<IReport>("Report", reportSchema);
export default Report;
