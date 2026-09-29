import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface INursingTask extends Document {
  hospital: mongoose.Types.ObjectId;
  admission: mongoose.Types.ObjectId;
  patient: mongoose.Types.ObjectId;
  nurse?: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  type: "Medication" | "Vitals" | "Diet" | "Wound Care" | "Clinical Notes" | "Other";
  priority: "Low" | "Medium" | "High" | "Critical";
  status: "Pending" | "In Progress" | "Completed" | "Cancelled";
  dueDate: Date;
  completedAt?: Date;
  completedBy?: mongoose.Types.ObjectId;
  notes?: string;
}

const nursingTaskSchema = new Schema<INursingTask>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    admission: {
      type: Schema.Types.ObjectId,
      ref: "IPDAdmission",
      required: true,
    },
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    nurse: { type: Schema.Types.ObjectId, ref: "User" },
    title: { type: String, required: true },
    description: { type: String },
    type: {
      type: String,
      enum: ["Medication", "Vitals", "Diet", "Wound Care", "Clinical Notes", "Other"],
      default: "Other",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium",
    },
    status: {
      type: String,
      enum: ["Pending", "In Progress", "Completed", "Cancelled"],
      default: "Pending",
    },
    dueDate: { type: Date, required: true },
    completedAt: { type: Date },
    completedBy: { type: Schema.Types.ObjectId, ref: "User" },
    notes: { type: String },
  },
  { timestamps: true },
);

// Index for performance
nursingTaskSchema.index({ hospital: 1, status: 1 });
nursingTaskSchema.index({ nurse: 1, status: 1 });
nursingTaskSchema.index({ admission: 1 });

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
nursingTaskSchema.plugin(multiTenancyPlugin);

const NursingTask = mongoose.model<INursingTask>(
  "NursingTask",
  nursingTaskSchema,
);
export default NursingTask;
