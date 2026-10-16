import mongoose, { Schema, Document } from "mongoose";

export interface IPublicAppointmentOtp extends Document {
  phone: string;
  hospital: mongoose.Types.ObjectId;
  otp: string;
  expiresAt: Date;
  attempts: number;
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const publicAppointmentOtpSchema = new Schema<IPublicAppointmentOtp>(
  {
    phone: { type: String, required: true, index: true },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// TTL index to automatically remove expired OTPs
publicAppointmentOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
publicAppointmentOtpSchema.index({ phone: 1, createdAt: -1 });

const PublicAppointmentOtp = mongoose.model<IPublicAppointmentOtp>(
  "PublicAppointmentOtp",
  publicAppointmentOtpSchema
);

export default PublicAppointmentOtp;
