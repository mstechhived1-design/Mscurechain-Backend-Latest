import mongoose, { Schema, Document } from "mongoose";

export interface IMobileAppointment extends Document {
  appointmentId: string;
  patient: mongoose.Types.ObjectId;
  doctor: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  date: Date;
  startTime: string; // e.g. "09:00 AM"
  endTime: string;   // e.g. "09:05 AM"
  hourlyBlock: string; // e.g. "09:00 AM - 10:00 AM"
  
  appointmentType: string; // Consultation, Follow-up, Routine, Emergency
  mode: "offline" | "online"; // OPD vs Video
  
  symptoms: string[];
  notes: string;
  
  vitals: {
    weight?: string;
    bp?: string;
    pulse?: string;
    temperature?: string;
    spO2?: string;
  };
  
  consultationFee: number;
  paymentStatus: "Pending" | "Paid" | "Failed" | "Refunded";
  paymentMethod: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  
  status: "Booked" | "Confirmed" | "Arrived" | "In-Progress" | "Completed" | "Cancelled";
  mrn?: string;
  tenantId: string;
  remindersSent: string[]; // Track intervals: ["1h", "3h", "1d", "2d", "3d"]
  createdAt: Date;
  updatedAt: Date;
}

const MobileAppointmentSchema: Schema = new Schema(
  {
    appointmentId: { type: String, required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: "PatientProfile", required: true },
    doctor: { type: Schema.Types.ObjectId, ref: "DoctorProfile", required: true },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    hourlyBlock: { type: String, required: true },
    
    appointmentType: { type: String, default: "Consultation" },
    mode: { type: String, enum: ["offline", "online"], default: "offline" },
    
    symptoms: [{ type: String }],
    notes: { type: String },
    
    vitals: {
      weight: { type: String },
      bp: { type: String },
      pulse: { type: String },
      temperature: { type: String },
      spO2: { type: String },
    },
    
    consultationFee: { type: Number, required: true },
    paymentStatus: { type: String, enum: ["Pending", "Paid", "Failed", "Refunded"], default: "Pending" },
    paymentMethod: { type: String, default: "razorpay" },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    
    status: { 
      type: String, 
      enum: ["Booked", "Confirmed", "Arrived", "In-Progress", "Completed", "Cancelled"],
      default: "Booked" 
    },
    mrn: { type: String },
    tenantId: { type: String },
    remindersSent: [{ type: String }],
  },
  { timestamps: true }
);

// Index for concurrency check
MobileAppointmentSchema.index({ doctor: 1, hospital: 1, date: 1, startTime: 1 }, { unique: true });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
MobileAppointmentSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IMobileAppointment>("MobileAppointment", MobileAppointmentSchema);
