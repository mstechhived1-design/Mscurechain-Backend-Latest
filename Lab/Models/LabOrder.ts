import mongoose, { Schema } from "mongoose";
import { ILabOrder } from "../types/index.js";

const labOrderSchema = new Schema<ILabOrder>(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    globalPatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Who created the request
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    tokenNumber: { type: String },
    sampleId: { type: String },
    prescription: { type: mongoose.Schema.Types.ObjectId, ref: "Prescription" },
    admission: { type: mongoose.Schema.Types.ObjectId, ref: "IPDAdmission" },
    priority: { type: String, default: "routine" },
    clinicalAnnotations: { type: String },
    tests: [
      {
        test: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "LabTest",
        },
        testName: String, // Redundant name for display resilience
        status: {
          type: String,
          enum: ["pending", "processing", "completed"],
          default: "pending",
        },
        cost: Number,
        result: String,
        remarks: String,
        isAbnormal: { type: Boolean, default: false },
        subTests: [
          {
            name: String,
            result: String,
            unit: String,
            range: String,
          },
        ],
      },
    ],
    status: {
      type: String,
      enum: ["prescribed", "sample_collected", "processing", "completed"],
      default: "prescribed",
    },
    detailedStatus: {
      type: String,
      enum: [
        "Ordered",
        "Collected",
        "Received",
        "Processing",
        "Verified",
        "Approved",
        "Delivered",
      ],
      default: "Ordered",
    },
    subtotal: { type: Number },
    discountAmount: { type: Number, default: 0 },
    discountReason: { type: String },
    totalAmount: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid"],
      default: "pending",
    },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    sampleCollectedAt: Date,
    resultsEnteredAt: Date,
    completedAt: Date,
    doctorNotified: { type: Boolean, default: false }, // NEW: Track if doctor has been notified
    isEdited: { type: Boolean, default: false },
    editReason: { type: String },
    editedAt: Date,
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

labOrderSchema.pre("save", async function (next) {
  if (!this.sampleId && this.hospital) {
    try {
      // Find the most recently created order that ACTUALLY HAS a sampleId
      const lastOrder = await mongoose
        .model("LabOrder")
        .findOne({ hospital: this.hospital, sampleId: { $exists: true, $ne: null } })
        .sort({ createdAt: -1, _id: -1 });

      let nextNum = 1;
      if (lastOrder && lastOrder.sampleId && lastOrder.sampleId.includes("-")) {
        const parts = lastOrder.sampleId.split("-");
        nextNum = parseInt(parts[parts.length - 1], 10) + 1;
      } else {
        // Fallback for the very first sequential order
        const count = await mongoose.model("LabOrder").countDocuments({ hospital: this.hospital });
        nextNum = count + 1;
      }
      // padStart(4, "0") ensures 0001, 0002... 9999. It naturally allows 10000+ without resetting.
      this.sampleId = `SMP-${nextNum.toString().padStart(4, "0")}`;
    } catch (err) {
      console.error("Error generating sampleId:", err);
      this.sampleId = `SMP-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
    }
  }
  next();
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
labOrderSchema.plugin(multiTenancyPlugin);

// Performance indexes for Lab dashboard
labOrderSchema.index({ hospital: 1, status: 1, createdAt: -1 });
labOrderSchema.index({ globalPatientId: 1, hospital: 1 });
labOrderSchema.index({ globalPatientId: 1, createdAt: -1 });
labOrderSchema.index({ hospital: 1, createdAt: -1 });
labOrderSchema.index({ patient: 1, createdAt: -1 });
labOrderSchema.index({ tokenNumber: 1 });
labOrderSchema.index({ createdAt: -1 });
labOrderSchema.index({ paymentStatus: 1, createdAt: -1 });

const LabOrder = mongoose.model<ILabOrder>("LabOrder", labOrderSchema);

// Explicitly drop legacy unique index on LabTest collection if it exists
mongoose.connection.on("open", () => {
  mongoose.connection.db
    ?.collection("labtests")
    .dropIndex("code_1")
    .catch(() => {});
});

export default LabOrder;
