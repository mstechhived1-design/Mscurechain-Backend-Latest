import mongoose, { Schema, Document } from "mongoose";

export interface IMrnCounter extends Document {
    hospital: mongoose.Types.ObjectId;
    sequence: number;
    createdAt: Date;
    updatedAt: Date;
}

const mrnCounterSchema = new Schema<IMrnCounter>(
    {
        hospital: {
            type: Schema.Types.ObjectId,
            ref: "Hospital",
            required: true,
            unique: true,
        },
        sequence: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    { timestamps: true }
);

const MrnCounter = mongoose.model<IMrnCounter>("MrnCounter", mrnCounterSchema);
export default MrnCounter;
