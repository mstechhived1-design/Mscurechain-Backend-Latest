import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IReturnItem {
    issuance: mongoose.Types.ObjectId;
    product: mongoose.Types.ObjectId;
    batch: mongoose.Types.ObjectId;
    productName: string;
    returnedQty: number;
    reason?: string;
}

export interface IMedicineReturn extends Document {
    admissionId: string;
    patient: mongoose.Types.ObjectId;
    hospital: mongoose.Types.ObjectId;
    pharmacy: mongoose.Types.ObjectId;
    returnedBy: mongoose.Types.ObjectId;
    approvedBy?: mongoose.Types.ObjectId;
    items: IReturnItem[];
    status: "PENDING" | "APPROVED" | "REJECTED";
    rejectionReason?: string;
    notes?: string;
    approvedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const returnItemSchema = new Schema<IReturnItem>({
    issuance: { type: Schema.Types.ObjectId, ref: "IPDMedicineIssuance", required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    batch: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
    productName: { type: String, required: true },
    returnedQty: { type: Number, required: true, min: 1 },
    reason: { type: String },
});

const medicineReturnSchema = new Schema<IMedicineReturn>(
    {
        admissionId: { type: String, required: true },
        patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
        hospital: {
            type: Schema.Types.ObjectId,
            ref: "Hospital",
            required: true,
        },
        pharmacy: {
            type: Schema.Types.ObjectId,
            ref: "PharmaProfile",
            required: true,
        },
        returnedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
        items: [returnItemSchema],
        status: {
            type: String,
            enum: ["PENDING", "APPROVED", "REJECTED"],
            default: "PENDING",
        },
        rejectionReason: { type: String },
        notes: { type: String },
        approvedAt: { type: Date },
    },
    { timestamps: true },
);

medicineReturnSchema.plugin(multiTenancyPlugin);

// Fast lookups per admission
medicineReturnSchema.index({ admissionId: 1, hospital: 1 });
medicineReturnSchema.index({ status: 1, hospital: 1 });

export default mongoose.model<IMedicineReturn>(
    "MedicineReturn",
    medicineReturnSchema,
);
