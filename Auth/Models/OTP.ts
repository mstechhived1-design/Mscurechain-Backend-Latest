import mongoose, { Schema } from "mongoose";
import { IOTP } from "../types/index.js";

const otpSchema = new Schema<IOTP>({
    mobile: { type: String, required: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OTP = mongoose.model<IOTP>("OTP", otpSchema);
export default OTP;
