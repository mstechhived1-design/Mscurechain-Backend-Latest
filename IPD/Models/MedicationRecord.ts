import mongoose, { Schema, Document } from "mongoose";

export interface IMedicationRecord extends Document {
  patient: mongoose.Types.ObjectId;
  globalPatientId?: mongoose.Types.ObjectId;
  admission: mongoose.Types.ObjectId;
  administeredBy: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  drugName: string;
  dose: string;
  prescription: mongoose.Types.ObjectId;
  medicineId: string;
  timeSlot: "Morning" | "Afternoon" | "Evening" | "Night" | "SOS" | "General" | "Custom";
  route:
    | "Oral"
    | "IV"
    | "IM"
    | "Subcutaneous"
    | "Inhalation"
    | "Topical"
    | "Other";
  status:
    | "Administered"
    | "Given"
    | "Missed"
    | "Delayed"
    | "Refused"
    | "Cancelled";
  notes?: string;
  timestamp: Date;
}

const medicationRecordSchema = new Schema<IMedicationRecord>(
  {
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    admission: {
      type: Schema.Types.ObjectId,
      ref: "IPDAdmission",
      required: true,
    },
    administeredBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    drugName: { type: String, required: true },
    dose: { type: String, required: true },
    prescription: {
      type: Schema.Types.ObjectId,
      ref: "Prescription",
      required: true,
    },
    medicineId: { type: String, required: true },
    timeSlot: {
      type: String,
      enum: ["Morning", "Afternoon", "Evening", "Night", "SOS", "General", "Custom"],
      required: true,
    },
    route: {
      type: String,
      enum: [
        "Oral",
        "IV",
        "IM",
        "Subcutaneous",
        "Inhalation",
        "Topical",
        "Other",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "Administered",
        "Given",
        "Missed",
        "Delayed",
        "Refused",
        "Cancelled",
      ],
      default: "Administered",
    },
    notes: { type: String },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
medicationRecordSchema.plugin(multiTenancyPlugin);

medicationRecordSchema.index({ globalPatientId: 1, hospital: 1 });
medicationRecordSchema.index({ admission: 1, status: 1 });

const MedicationRecord = mongoose.model<IMedicationRecord>(
  "MedicationRecord",
  medicationRecordSchema,
);
export default MedicationRecord;
