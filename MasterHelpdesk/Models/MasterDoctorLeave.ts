import mongoose, { Schema, Document, Types } from "mongoose";

export interface IMasterDoctorLeave extends Document {
  doctor: Types.ObjectId;       // ref → User (doctor's User ID)
  doctorProfile: Types.ObjectId; // ref → DoctorProfile
  hospital: Types.ObjectId;
  startDate: Date;
  endDate: Date;
  reason: string;
  leaveType: "sick" | "casual" | "emergency" | "maternity" | "vacation" | "other";
  status: "pending" | "approved" | "rejected";
  reviewedBy?: Types.ObjectId;  // MasterHelpdesk user who reviewed
  reviewNote?: string;
  emergencyDetails?: string;    // Mandatory if 3+ appointments exist
  agreedToTerms?: boolean;      // Mandatory if 3+ appointments exist
  appointmentsFoundAtRequest?: number;
  createdAt: Date;
  updatedAt: Date;
}

const masterDoctorLeaveSchema = new Schema<IMasterDoctorLeave>(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    doctorProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorProfile",
    },
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate:   { type: Date, required: true },
    reason:    { type: String, required: true, trim: true },
    leaveType: {
      type: String,
      enum: ["sick", "casual", "emergency", "maternity", "vacation", "other"],
      default: "sick",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewNote: { type: String },
    emergencyDetails: { type: String },
    agreedToTerms: { type: Boolean, default: false },
    appointmentsFoundAtRequest: { type: Number, default: 0 },
  },
  { timestamps: true },
);

masterDoctorLeaveSchema.index({ hospital: 1, status: 1 });
masterDoctorLeaveSchema.index({ doctor: 1, status: 1 });

const MasterDoctorLeave = mongoose.model<IMasterDoctorLeave>(
  "MasterDoctorLeave",
  masterDoctorLeaveSchema,
);
export default MasterDoctorLeave;
