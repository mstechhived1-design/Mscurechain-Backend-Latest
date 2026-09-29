import mongoose, { Document, Schema } from 'mongoose';
import multiTenancyPlugin from '../../middleware/tenantPlugin.js';

export interface IHospitalCharge extends Document {
  hospital: mongoose.Types.ObjectId;
  category: string;
  description: string;
  amount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const hospitalChargeSchema = new Schema<IHospitalCharge>(
  {
    hospital: {
      type: Schema.Types.ObjectId,
      ref: 'Hospital',
      required: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
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

// Indexes for performance and uniqueness
hospitalChargeSchema.index({ hospital: 1, category: 1 });
hospitalChargeSchema.index({ hospital: 1, category: 1, description: 1 }, { unique: true });

// Multi-tenancy plugin
hospitalChargeSchema.plugin(multiTenancyPlugin);

export const HospitalCharge = mongoose.model<IHospitalCharge>('HospitalCharge', hospitalChargeSchema);
export default HospitalCharge;
