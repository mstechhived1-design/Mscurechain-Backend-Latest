import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IIssuanceItem {
    product: mongoose.Types.ObjectId;
    batch: mongoose.Types.ObjectId;
    productName: string;
    batchNo: string;
    issuedQty: number;
    returnedQty: number;
    unitRate: number;
    totalAmount: number;
    frequency?: any;
}

export interface IIPDMedicineIssuance extends Document {
    admissionId: string;
    admission: mongoose.Types.ObjectId;
    patient: mongoose.Types.ObjectId;
    hospital: mongoose.Types.ObjectId;
    pharmacy: mongoose.Types.ObjectId;
    issuedBy: mongoose.Types.ObjectId;
    requestedBy: mongoose.Types.ObjectId;
    receivedByNurse?: mongoose.Types.ObjectId;  // nurse who received medicines
    nurseNote?: string;                          // nurse name string (denormalized)
    items: IIssuanceItem[];
    status: "ISSUED" | "RETURN_REQUESTED" | "RETURN_APPROVED" | "CLOSED";
    totalAmount: number;
    invoiceNo?: string;
    notes?: string;
    issuedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const issuanceItemSchema = new Schema<IIssuanceItem>({
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    batch: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
    productName: { type: String, required: true },
    batchNo: { type: String, required: true },
    issuedQty: { type: Number, required: true, min: 1 },
    returnedQty: { type: Number, default: 0, min: 0 },
    unitRate: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    frequency: { type: Schema.Types.Mixed },
});

const ipdMedicineIssuanceSchema = new Schema<IIPDMedicineIssuance>(
    {
        admissionId: { type: String, required: true },
        admission: {
            type: Schema.Types.ObjectId,
            ref: "IPDAdmission",
            required: true,
        },
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
        issuedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        receivedByNurse: { type: Schema.Types.ObjectId, ref: "User", default: null },
        nurseNote: { type: String, default: null },
        items: [issuanceItemSchema],
        status: {
            type: String,
            enum: ["ISSUED", "RETURN_REQUESTED", "RETURN_APPROVED", "CLOSED"],
            default: "ISSUED",
        },
        totalAmount: { type: Number, required: true },
        invoiceNo: { type: String, unique: true, sparse: true },
        notes: { type: String },
        issuedAt: { type: Date, default: Date.now },
    },
    { timestamps: true },
);

ipdMedicineIssuanceSchema.plugin(multiTenancyPlugin);

// Fast lookups per admission and hospital
ipdMedicineIssuanceSchema.index({ admissionId: 1, hospital: 1 });
ipdMedicineIssuanceSchema.index({ patient: 1, hospital: 1 });

export default mongoose.model<IIPDMedicineIssuance>(
    "IPDMedicineIssuance",
    ipdMedicineIssuanceSchema,
);
