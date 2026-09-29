import mongoose, { Schema, Document } from 'mongoose';

export interface ITrainingRecord extends Document {
    trainingName: string;
    trainingDate: Date;
    department: string;
    participants: mongoose.Types.ObjectId[]; // Array of User ObjectIds
    hospitalId: mongoose.Types.ObjectId;
    description?: string;
    certificateUrl?: string;
    status: 'Scheduled' | 'Completed' | 'Cancelled';
    cancellationReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const TrainingRecordSchema: Schema = new Schema(
    {
        trainingName: { type: String, required: true },
        trainingDate: { type: Date, required: true },
        department: { type: String, required: true },
        participants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
        hospitalId: { type: Schema.Types.ObjectId, ref: 'Hospital', required: true },
        description: { type: String },
        certificateUrl: { type: String },
        status: {
            type: String,
            enum: ['Scheduled', 'Completed', 'Cancelled'],
            default: 'Scheduled',
        },
        cancellationReason: { type: String },
    },
    { timestamps: true }
);

// Index for efficient querying
TrainingRecordSchema.index({ hospitalId: 1, trainingDate: -1 });
TrainingRecordSchema.index({ participants: 1 });

export default mongoose.model<ITrainingRecord>('TrainingRecord', TrainingRecordSchema);
