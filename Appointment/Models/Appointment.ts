import mongoose, { Schema } from "mongoose";
import { IAppointment } from "../types/index.js";

const appointmentSchema = new Schema<IAppointment>(
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
      ref: "DoctorProfile",
      required: true,
    },
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HelpDesk",
    },

    date: {
      type: Date,
      required: true,
    },

    appointmentTime: {
      type: String, // "10:30 AM"
    },
    startTime: String,
    endTime: String,

    appointmentId: {
      type: String, // APT-20260107-001
      unique: true,
    },
    admissionId: {
      type: String,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "in-progress",
        "Booked",
        "booked",
        "waiting",
        "scheduled",
        "Arrived",
        "admitted"
      ],
      default: "Booked",
    },

    symptoms: [String],
    reason: String,

    mrn: String,
    department: String,

    vitals: {
      bloodPressure: String,
      temperature: String,
      pulse: String,
      spO2: String,
      height: String,
      weight: String,
      glucose: String,
    },

    patientDetails: {
      name: String,
      honorific: String,
      age: String,
      gender: String,
      duration: String,
      guardianName: String,
      guardianRelation: String,
      guardianMobile: String,
      doctorReference: String,
    },

    appointmentHonorific: String,
    honorific: String,
    guardianName: String,
    guardianRelation: String,
    guardianMobile: String,
    doctorReference: String,

    reports: [String],

    type: {
      type: String,
      enum: [
        "online",
        "offline",
        "OPD",
        "IPD",
        "follow-up",
        "consultation",
        "emergency",
        "procedure",
        "Consultation",
        "Routine",
      ],
      default: "offline",
    },

    visitType: {
      type: String,
    },

    urgency: {
      type: String,
      enum: [
        "urgent",
        "non-urgent",
        "Emergency - Visit Hospital Immediately",
        "Consult Doctor Soon",
        "Non-urgent",
      ],
      default: "non-urgent",
    },

    payment: {
      amount: Number,
      fee: Number,
      totalBillAmount: Number,
      originalAmount: Number,
      discount: { type: Number, default: 0 },
      discountType: { type: String, default: "flat" },
      discountValue: { type: Number, default: 0 },
      paymentMethod: String,
      paymentStatus: {
        type: String,
        enum: ["pending", "paid", "failed", "not_required", "Paid"],
        default: "pending",
      },
      receiptNumber: String,
      razorpayOrderId: String,
      razorpayPaymentId: String,
      razorpaySignature: String,
      paymentDetails: Schema.Types.Mixed,
    },

    amount: Number,
    fee: Number,
    totalBillAmount: Number,
    originalAmount: Number,
    discount: { type: Number, default: 0 },
    discountType: { type: String, default: "flat" },
    discountValue: { type: Number, default: 0 },
    paymentStatus: String,
    paymentMethod: String,

    consultationStartTime: Date,
    consultationEndTime: Date,
    consultationDuration: Number, // seconds

    prescription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prescription",
    },

    labToken: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LabToken",
    },

    pharmacyToken: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PharmacyToken",
    },

    documentsCollected: {
      type: Boolean,
      default: false,
    },
    documentsCollectedAt: Date,
    cloudinaryDocumentUrl: String,
    cloudinaryLabTokenUrl: String,

    sentToHelpdesk: {
      type: Boolean,
      default: false,
    },
    sentToHelpdeskAt: Date,

    transitStatus: {
      type: String,
      default: "pending",
    },

    isIPD: {
      type: Boolean,
      default: false,
    },

    // Pause / Resume
    isPaused: {
      type: Boolean,
      default: false,
    },
    pausedAt: Date,
    resumedAt: Date,
    pausedDuration: {
      type: Number,
      default: 0,
    },

    // TV Queue fields
    token_number: String,
    queue_status: {
      type: String,
      enum: ["WAITING", "CURRENT", "CALLED", "COMPLETED"],
      default: "WAITING",
    },
    called_time: Date,

    diagnosis: String,
    clinicalNotes: String,
    plan: String,
    isEdited: { type: Boolean, default: false },
    editReason: { type: String },
    editedAt: { type: Date },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // ─── Follow-up Status Snapshot ──────────────────────────────────────────
    // Captured at booking time from the hospital's current follow-up settings.
    // Storing this ensures historical receipts always reflect the original
    // expiry date regardless of future hospital setting changes.
    followUpStatus: {
      eligible:        { type: Boolean },
      visitCount:      { type: Number },
      doctorVisitCount:{ type: Number },
      rangeDays:       { type: Number },   // hospital.opdFollowUpDays / ipdFollowUpDays at booking time
      expiryDate:      { type: Date },     // lastPaidDate + rangeDays (the canonical expiry)
      enableExpiry:    { type: Boolean },  // hospital.enableFollowUpExpiry at booking time
      message:         { type: String },
      calculatedAt:    { type: Date },     // timestamp of calculation
    },
  },
  { timestamps: true },
);

// 🛡️ Pre-save hook to sync isIPD with type and manage admissionId
appointmentSchema.pre("save", function (next) {
  if (this.type && this.type.toUpperCase() === "IPD") {
    this.isIPD = true;
    // Generate admissionId if it's IPD and missing
    if (!this.admissionId) {
      const timestamp = Date.now().toString();
      const random = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, "0");
      this.admissionId = `ADM-${timestamp}-${random}`;
    }
  } else {
    // Ensure admissionId is empty if it's not an IPD appointment
    this.admissionId = undefined;
  }
  next();
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
appointmentSchema.plugin(multiTenancyPlugin);

/* Indexes */
appointmentSchema.index({ hospital: 1, date: -1, status: 1 });
appointmentSchema.index({ doctor: 1, date: -1, status: 1 });
appointmentSchema.index({ patient: 1, date: -1 });
appointmentSchema.index({ globalPatientId: 1, hospital: 1 });
appointmentSchema.index({ globalPatientId: 1, createdAt: -1 });
appointmentSchema.index({ createdAt: -1 });
appointmentSchema.index({
  hospital: 1,
  sentToHelpdesk: 1,
  transitStatus: 1,
  status: 1,
});
appointmentSchema.index({ transitStatus: 1 });

const Appointment = mongoose.model<IAppointment>(
  "Appointment",
  appointmentSchema,
);

export default Appointment;
