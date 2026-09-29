import mongoose, { Document, Schema } from 'mongoose';

interface IBreakdownItem {
  name: string;
  amount: number;
  testId?: string; // For lab tests referencing existing catalog
}

export interface IHospitalPackage extends Document {
  name: string;
  description?: string;
  hospital: mongoose.Types.ObjectId;
  totalPrice: number;
  discountPercentage?: number;
  discountAmount?: number;
  breakdown: {
    doctorFees: number;
    labCharges: number;
    pharmacyCharges: number;
    radiologyCharges: number;
    roomCharges: number;
    otherCharges: number;
  };
  breakdownItems: {
    doctorFees: IBreakdownItem[];
    labCharges: IBreakdownItem[];
    pharmacyCharges: IBreakdownItem[];
    radiologyCharges: IBreakdownItem[];
    roomCharges: IBreakdownItem[];
    otherCharges: IBreakdownItem[];
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const breakdownItemSchema = new Schema(
  {
    name: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    testId: { type: String },
  },
  { _id: false }
);

const hospitalPackageSchema = new Schema<IHospitalPackage>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    hospital: {
      type: Schema.Types.ObjectId,
      ref: 'Hospital',
      required: true,
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    discountPercentage: {
      type: Number,
      min: 0,
      max: 100,
    },
    discountAmount: {
      type: Number,
      min: 0,
    },
    breakdown: {
      doctorFees: { type: Number, default: 0, min: 0 },
      labCharges: { type: Number, default: 0, min: 0 },
      pharmacyCharges: { type: Number, default: 0, min: 0 },
      radiologyCharges: { type: Number, default: 0, min: 0 },
      roomCharges: { type: Number, default: 0, min: 0 },
      otherCharges: { type: Number, default: 0, min: 0 },
    },
    breakdownItems: {
      doctorFees: { type: [breakdownItemSchema], default: [] },
      labCharges: { type: [breakdownItemSchema], default: [] },
      pharmacyCharges: { type: [breakdownItemSchema], default: [] },
      radiologyCharges: { type: [breakdownItemSchema], default: [] },
      roomCharges: { type: [breakdownItemSchema], default: [] },
      otherCharges: { type: [breakdownItemSchema], default: [] },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure the name is unique within a hospital
hospitalPackageSchema.index({ hospital: 1, name: 1 }, { unique: true });

export const HospitalPackage = mongoose.model<IHospitalPackage>('HospitalPackage', hospitalPackageSchema);
export default HospitalPackage;
