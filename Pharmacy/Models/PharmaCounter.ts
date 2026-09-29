import mongoose, { Schema, Document } from "mongoose";

export interface IPharmaCounter extends Document {
    pharmacy: mongoose.Types.ObjectId;
    type: "invoice" | "order" | "issuance";
    sequence: number;
    createdAt: Date;
    updatedAt: Date;
}

const pharmaCounterSchema = new Schema<IPharmaCounter>(
    {
        pharmacy: {
            type: Schema.Types.ObjectId,
            ref: "PharmaProfile",
            required: true,
        },
        type: {
            type: String,
            enum: ["invoice", "order", "issuance"],
            required: true,
        },
        sequence: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    { timestamps: true }
);

// Compound unique index per pharmacy and type
pharmaCounterSchema.index({ pharmacy: 1, type: 1 }, { unique: true });

const PharmaCounter = mongoose.model<IPharmaCounter>("PharmaCounter", pharmaCounterSchema);
export default PharmaCounter;
