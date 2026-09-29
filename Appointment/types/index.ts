import { Document, Types } from "mongoose";
import { Request } from "express";

import { IUser, IPatient, ISuperAdmin } from "../../Auth/types/index.js";
import { IDoctorProfile } from "../../Doctor/types/index.js";
import { IHospital } from "../../Hospital/types/index.js";

export interface IAppointment extends Document {
  patient: Types.ObjectId | IUser;
  globalPatientId?: Types.ObjectId;
  doctor: Types.ObjectId | IDoctorProfile;
  hospital: Types.ObjectId | IHospital;

  createdBy?: Types.ObjectId; // HelpDesk reference

  date: Date;

  appointmentTime?: string; // "10:30 AM"
  startTime?: string;
  endTime?: string;

  status:
    | "pending"
    | "confirmed"
    | "cancelled"
    | "completed"
    | "in-progress"
    | "Booked"
    | "booked"
    | "waiting"
    | "scheduled"
    | "Arrived"
    | "admitted";

  appointmentId?: string;
  admissionId?: string;

  department?: string;
  visitType?: string;

  symptoms?: string[];
  reason?: string;
  mrn?: string;

  vitals?: {
    bloodPressure?: string;
    temperature?: string;
    pulse?: string;
    spO2?: string;
    height?: string;
    weight?: string;
    glucose?: string;
  };

  patientDetails?: {
    name?: string;
    honorific?: string;
    age?: string;
    gender?: string;
    duration?: string;
    guardianName?: string;
    guardianRelation?: string;
    guardianMobile?: string;
    doctorReference?: string;
  };

  appointmentHonorific?: string;
  honorific?: string;
  guardianName?: string;
  guardianRelation?: string;
  guardianMobile?: string;
  doctorReference?: string;

  reports?: string[];

  type?:
  | "online"
  | "offline"
  | "OPD"
  | "IPD"
  | "follow-up"
  | "consultation"
  | "emergency"
  | "procedure"
  | "Consultation"
  | "Routine";

  urgency?:
  | "urgent"
  | "non-urgent"
  | "Emergency - Visit Hospital Immediately"
  | "Consult Doctor Soon"
  | "Non-urgent";

  payment?: {
    amount?: number;
    fee?: number;
    totalBillAmount?: number;
    originalAmount?: number;
    discount?: number;
    discountType?: string;
    discountValue?: number;
    paymentMethod?: string;
    paymentStatus?: "pending" | "paid" | "failed" | "not_required" | "Paid";
    receiptNumber?: string;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
    paymentDetails?: any;
  };

  amount?: number;
  fee?: number;
  totalBillAmount?: number;
  originalAmount?: number;
  discount?: number;
  discountType?: string;
  discountValue?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  stripeSessionId?: string;

  createdAt: Date;
  updatedAt: Date;

  // Consultation tracking
  consultationStartTime?: Date;
  consultationEndTime?: Date;
  consultationDuration?: number; // seconds

  prescription?: Types.ObjectId;
  labToken?: Types.ObjectId;
  pharmacyToken?: Types.ObjectId;

  documentsCollected?: boolean;
  documentsCollectedAt?: Date;
  cloudinaryDocumentUrl?: string;
  cloudinaryLabTokenUrl?: string;

  sentToHelpdesk?: boolean;
  sentToHelpdeskAt?: Date;

  transitStatus?: string;
  isIPD?: boolean;

  // Pause / Resume tracking
  isPaused?: boolean;
  pausedAt?: Date;
  resumedAt?: Date;
  pausedDuration?: number;

  // TV Queue tracking
  token_number?: string;
  queue_status?: "WAITING" | "CURRENT" | "CALLED" | "COMPLETED";
  called_time?: Date;

  diagnosis?: string;
  clinicalNotes?: string;
  plan?: string;

  isEdited?: boolean;
  editReason?: string;
  editedAt?: Date;
  editedBy?: Types.ObjectId;

  // ─── Follow-up Status Snapshot ──────────────────────────────────────────
  // Persisted at booking time. Never recalculated. Historical receipts always
  // reflect the expiry date that was valid when the appointment was booked.
  followUpStatus?: {
    eligible?: boolean;
    visitCount?: number;
    doctorVisitCount?: number;
    rangeDays?: number;
    expiryDate?: Date;
    enableExpiry?: boolean;
    message?: string;
    calculatedAt?: Date;
  };
}

export interface AppointmentRequest extends Request {
  user?: IUser | IPatient | ISuperAdmin | any;
}
