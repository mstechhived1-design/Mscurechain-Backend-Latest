import mongoose, { Document, Schema } from 'mongoose';

export interface ITicketSyncQueue extends Document {
    hospital: mongoose.Types.ObjectId;
    ticketId: mongoose.Types.ObjectId;
    payload: any;
    retryCount: number;
    lastAttempt?: Date;
    error?: string;
    status: 'pending' | 'synced' | 'failed';
    createdAt: Date;
    updatedAt: Date;
}

const TicketSyncQueueSchema = new Schema<ITicketSyncQueue>(
    {
        hospital: {
            type: Schema.Types.ObjectId,
            ref: 'Hospital',
            required: true,
            },
        ticketId: {
            type: Schema.Types.ObjectId,
            ref: 'SupportRequest',
            required: true,
            index: true
        },
        payload: {
            type: Schema.Types.Mixed,
            required: true
        },
        retryCount: {
            type: Number,
            default: 0
        },
        lastAttempt: {
            type: Date
        },
        error: {
            type: String
        },
        status: {
            type: String,
            enum: ['pending', 'synced', 'failed'],
            default: 'pending',
            index: true
        }
    },
    {
        timestamps: true
    }
);

// Index for efficient querying of pending sync items per hospital
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
TicketSyncQueueSchema.plugin(multiTenancyPlugin);

TicketSyncQueueSchema.index({ hospital: 1, status: 1 });
TicketSyncQueueSchema.index({ hospital: 1, status: 1, retryCount: 1, createdAt: 1 });

export default mongoose.model<ITicketSyncQueue>('TicketSyncQueue', TicketSyncQueueSchema);
