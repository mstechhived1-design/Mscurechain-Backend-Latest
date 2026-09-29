import mongoose, { Schema, Document } from "mongoose";

export interface ILabToken extends Document {
  appointment: mongoose.Types.ObjectId;
  patient: mongoose.Types.ObjectId;
  globalPatientId?: mongoose.Types.ObjectId;
  doctor: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  tokenNumber: string;
  tests: {
    name: string;
    category: string;
    instructions?: string;
    price: number;
  }[];
  priority: "routine" | "urgent" | "stat";
  status: "pending" | "collected" | "processing" | "completed";
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LabTokenSchema: Schema = new Schema(
  {
    appointment: { type: Schema.Types.ObjectId, ref: "Appointment" },
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    doctor: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    tokenNumber: { type: String },
    tests: [
      {
        name: { type: String, required: true },
        category: { type: String, required: true },
        instructions: { type: String },
        price: { type: Number, required: true, default: 0 },
      },
    ],
    priority: {
      type: String,
      enum: ["routine", "urgent", "stat"],
      default: "routine",
    },
    status: {
      type: String,
      enum: ["pending", "collected", "processing", "completed"],
      default: "pending",
    },
    notes: { type: String },
  },
  {
    timestamps: true,
  },
);

// Generate token number before saving
LabTokenSchema.pre("save", async function (next) {
  if (!this.tokenNumber) {
    const count = await mongoose.model("LabToken").countDocuments();
    this.tokenNumber = `LAB-${Date.now()}-${count + 1}-${Math.floor(
      Math.random() * 1000,
    )
      .toString()
      .padStart(3, "0")}`;
  }
  next();
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
LabTokenSchema.plugin(multiTenancyPlugin);

LabTokenSchema.index({ tokenNumber: 1, hospital: 1 }, { unique: true });
LabTokenSchema.index({ globalPatientId: 1, hospital: 1 });
LabTokenSchema.index({ globalPatientId: 1, createdAt: -1 });
LabTokenSchema.index({ doctor: 1, createdAt: -1 });

export default mongoose.model<ILabToken>("LabToken", LabTokenSchema);
