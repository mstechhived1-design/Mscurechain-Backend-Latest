import mongoose, { Schema, Document } from "mongoose";

export interface IPatientMedicineIntake extends Document {
  patient: mongoose.Types.ObjectId;
  prescriptionId: string;
  medicineId: string;
  medicineName: string;
  dosage: string;
  timeSlot: string; // 'Morning' | 'Afternoon' | 'Evening' | 'Night' | 'Custom'
  scheduledTime: string;
  date: string; // 'YYYY-MM-DD'
  takenAt?: Date;
  status: "taken" | "skipped" | "untaken";
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const patientMedicineIntakeSchema = new Schema<IPatientMedicineIntake>(
  {
    patient: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    prescriptionId: {
      type: String,
      required: true,
      index: true,
    },
    medicineId: {
      type: String,
      required: true,
      index: true,
    },
    medicineName: {
      type: String,
      required: true,
    },
    dosage: {
      type: String,
      default: "1 Dose",
    },
    timeSlot: {
      type: String,
      required: true,
    },
    scheduledTime: {
      type: String,
      default: "",
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    takenAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["taken", "skipped", "untaken"],
      default: "taken",
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

patientMedicineIntakeSchema.index({ patient: 1, date: 1, medicineId: 1, timeSlot: 1 });
patientMedicineIntakeSchema.index({ patient: 1, status: 1, takenAt: -1 });

const PatientMedicineIntake = mongoose.model<IPatientMedicineIntake>(
  "PatientMedicineIntake",
  patientMedicineIntakeSchema
);

export default PatientMedicineIntake;
