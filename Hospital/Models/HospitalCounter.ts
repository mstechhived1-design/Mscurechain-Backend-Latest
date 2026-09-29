import mongoose, { Schema, Document } from "mongoose";

export interface IHospitalCounter extends Document {
  hospital: mongoose.Types.ObjectId;
  type: string; // 'OPD', 'IPD', 'APT', 'REC' etc.
  sequence: number;
}

const hospitalCounterSchema = new Schema<IHospitalCounter>({
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
  sequence: {
    type: Number,
    default: 0,
  },
});

// Compound index for fast lookup
hospitalCounterSchema.index({ hospital: 1, type: 1 }, { unique: true });

const HospitalCounter = mongoose.model<IHospitalCounter>(
  "HospitalCounter",
  hospitalCounterSchema,
);

export default HospitalCounter;
