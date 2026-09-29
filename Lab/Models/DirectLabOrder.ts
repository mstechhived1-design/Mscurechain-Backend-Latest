import mongoose, { Schema, Document } from "mongoose";

export interface IDirectLabOrder extends Document {
  orderNumber: string;
  walkInPatient: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  labTechnician?: mongoose.Types.ObjectId;
  tests: {
    test: mongoose.Types.ObjectId;
    status: "pending" | "processing" | "completed";
    cost?: number;
    result?: string;
    remarks?: string;
    isAbnormal: boolean;
    subTests?: {
      name: string;
      result: string;
      unit: string;
      range: string;
    }[];
  }[];
  totalAmount: number;
  discount: number;
  finalAmount: number;
  paymentStatus: "pending" | "paid";
  paymentMethod?: "cash" | "card" | "upi" | "online";
  transactionId?: string;
  status:
  | "registered"
  | "paid"
  | "sample_collected"
  | "processing"
  | "completed";
  sampleType: string;
  sampleCollectedAt?: Date;
  resultsEnteredAt?: Date;
  reportGeneratedAt?: Date;
  completedAt?: Date;
  referredBy?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const directLabOrderSchema = new Schema<IDirectLabOrder>(
  {
    orderNumber: {
      type: String,
      required: true,
    },
    walkInPatient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WalkInPatient",
      required: true,
    },
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    labTechnician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    tests: [
      {
        test: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "LabTest",
          required: true,
        },
        testName: String,
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
    totalAmount: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    finalAmount: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "upi", "online"],
    },
    transactionId: String,
    status: {
      type: String,
      enum: [
        "registered",
        "paid",
        "sample_collected",
        "processing",
        "completed",
      ],
      default: "registered",
    },
    sampleType: {
      type: String,
      default: "Blood",
    },
    sampleCollectedAt: Date,
    resultsEnteredAt: Date,
    reportGeneratedAt: Date,
    completedAt: Date,
    referredBy: {
      type: String,
      default: "Self",
    },
    notes: String,
  },
  {
    timestamps: true,
  },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
directLabOrderSchema.plugin(multiTenancyPlugin);

// Auto-generate order number
directLabOrderSchema.pre("save", async function (next) {
  if (!this.orderNumber) {
    // Count will be scoped by plugin if context exists
    const count = await mongoose.model("DirectLabOrder").countDocuments();
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    this.orderNumber = `DL${year}${month}${(count + 1).toString().padStart(5, "0")}`;
  }
  next();
});

// Indexes for performance
directLabOrderSchema.index({ orderNumber: 1, hospital: 1 }, { unique: true });
directLabOrderSchema.index({ hospital: 1, status: 1, createdAt: -1 });
directLabOrderSchema.index({ walkInPatient: 1, createdAt: -1 });
directLabOrderSchema.index({ paymentStatus: 1, createdAt: -1 });
directLabOrderSchema.index({ status: 1, createdAt: -1 });

const DirectLabOrder = mongoose.model<IDirectLabOrder>(
  "DirectLabOrder",
  directLabOrderSchema,
);

export default DirectLabOrder;
