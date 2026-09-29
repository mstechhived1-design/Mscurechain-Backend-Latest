import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomMedicine extends Document {
    hospital: mongoose.Types.ObjectId;
    name: string;
    brand?: string;
    generic?: string;
    form?: string;
    dosage?: string;
    timesPrescribed: number;
    lastUsedAt: Date;
}

const CustomMedicineSchema: Schema = new Schema(
    {
        hospital: {
            type: Schema.Types.ObjectId,
            ref: 'Hospital',
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        brand: {
            type: String,
            default: '',
            trim: true,
        },
        generic: {
            type: String,
            default: '',
            trim: true,
        },
        form: {
            type: String,
            default: 'Tablet',
        },
        dosage: {
            type: String,
            default: '',
        },
        timesPrescribed: {
            type: Number,
            default: 1,
        },
        lastUsedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index for quick lookup per hospital
CustomMedicineSchema.index({ hospital: 1, name: 1 }, { unique: true });

export default mongoose.models.CustomMedicine ||
    mongoose.model<ICustomMedicine>('CustomMedicine', CustomMedicineSchema);
