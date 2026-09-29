import mongoose, { Schema, Document } from "mongoose";

export interface IEmergencyRequest extends Document {
  _id: mongoose.Types.ObjectId;
  ambulancePersonnel?: mongoose.Types.ObjectId;
  patient?: mongoose.Types.ObjectId;
  patientName: string;
  patientAge: number;
  patientGender: "male" | "female" | "other";
  patientMobile?: string;
  emergencyType: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  vitals?: {
    bloodPressure?: string;
    heartRate?: number;
    temperature?: number;
    oxygenLevel?: number;
  };
  currentLocation: string;
  eta?: number; // estimated time of arrival in minutes
  requestedHospitals: Array<{
    hospital: mongoose.Types.ObjectId;
    status: "pending" | "accepted" | "rejected";
    respondedAt?: Date;
    respondedBy?: mongoose.Types.ObjectId;
    rejectionReason?: string;
  }>;
  status: "pending" | "accepted" | "rejected" | "completed" | "cancelled";
  acceptedByHospital?: mongoose.Types.ObjectId;
  acceptedByHelpdesk?: mongoose.Types.ObjectId;
  acceptedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const emergencyRequestSchema = new Schema<IEmergencyRequest>(
  {
    ambulancePersonnel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AmbulancePersonnel",
      required: false,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: false,
    },
    patientName: { type: String, required: true },
    patientAge: { type: Number, required: true },
    patientGender: {
      type: String,
      enum: ["male", "female", "other"],
      required: true,
    },
    patientMobile: { type: String },
    emergencyType: { type: String, required: true },
    description: { type: String, required: true },
    severity: {
      type: String,
      enum: ["critical", "high", "medium", "low"],
      required: true,
    },
    vitals: {
      bloodPressure: String,
      heartRate: Number,
      temperature: Number,
      oxygenLevel: Number,
    },
    currentLocation: { type: String, required: true },
    eta: { type: Number }, // in minutes
    requestedHospitals: [
      {
        hospital: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Hospital",
          required: true,
        },
        status: {
          type: String,
          enum: ["pending", "accepted", "rejected"],
          default: "pending",
        },
        respondedAt: Date,
        respondedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "HelpDesk",
        },
        rejectionReason: String,
      },
    ],
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "completed", "cancelled"],
      default: "pending",
    },
    acceptedByHospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
    },
    acceptedByHelpdesk: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HelpDesk",
    },
    acceptedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancellationReason: String,
    notes: String,
  },
  { timestamps: true },
);

const EmergencyRequest = mongoose.model<IEmergencyRequest>(
  "EmergencyRequest",
  emergencyRequestSchema,
);

export default EmergencyRequest;
