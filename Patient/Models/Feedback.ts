import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IFeedback extends Document {
  patient: mongoose.Types.ObjectId;
  doctor?: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId[];
  rating: number;
  category: string[];
  comment?: string;
  isAnonymous: boolean;
  status: "New" | "In Progress" | "Resolved" | "Closed";
  createdAt: Date;
  updatedAt: Date;
}

const feedbackSchema = new Schema<IFeedback>(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PatientProfile",
      required: true,
    },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorProfile" },
    hospital: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    }],
    rating: { type: Number, required: true, min: 1, max: 5 },
    category: [{
      type: String,
      required: true,
      enum: [
        "Clinical Care",
        "Staff Behavior",
        "Facilities",
        "Wait Time",
        "Billing",
        "Other",
      ],
    }],
    comment: { type: String },
    isAnonymous: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["New", "In Progress", "Resolved", "Closed"],
      default: "In Progress",
    },
  },
  { timestamps: true },
);

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
feedbackSchema.plugin(multiTenancyPlugin);

const Feedback = mongoose.model<IFeedback>("Feedback", feedbackSchema);
export default Feedback;
