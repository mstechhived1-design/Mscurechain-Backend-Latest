import mongoose, { Schema, Document } from "mongoose";

export interface IAuthLog extends Document {
  user: mongoose.Types.ObjectId;
  userModel: "User" | "SuperAdmin" | "Patient" | "AmbulancePersonnel";
  role: string;
  hospital?: mongoose.Types.ObjectId;
  status: "success" | "failed";
  ip?: string;
  userAgent?: string;
  loginAt: Date;
  logoutAt?: Date;
  duration?: string; // e.g., "15m", "2h 10m"
  reason?: string; // e.g., "invalid password", "account locked"
}

const authLogSchema = new Schema<IAuthLog>(
  {
    user: { 
      type: Schema.Types.ObjectId, 
      refPath: "userModel", 
      required: false 
    },
    userModel: { 
      type: String, 
      required: true, 
      enum: ["User", "SuperAdmin", "Patient", "AmbulancePersonnel"], 
      default: "User" 
    },
    role: { type: String, required: true },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: false },
    status: { type: String, enum: ["success", "failed"], required: true },
    ip: String,
    userAgent: String,
    loginAt: { type: Date, default: Date.now },
    logoutAt: Date,
    duration: String,
    reason: String,
  },
  { timestamps: false }
);

// No tenant scoping here — logs are global for SuperAdmin to view.
const AuthLog = mongoose.model<IAuthLog>("AuthLog", authLogSchema);
export default AuthLog;
