import { Document, Types } from 'mongoose';
import { Request } from 'express';
import { IUser } from '../../Auth/types/index.js';

export interface IReply {
    senderId: Types.ObjectId | IUser;
    senderName?: string;
    role: string;
    message: string;
    attachments?: string[];
    createdAt?: Date;
}

export interface IInternalNote {
    senderId: Types.ObjectId | IUser;
    senderName?: string;
    message: string;
    createdAt?: Date;
}

export interface ISupportRequest extends Document {
    ticketId: string;
    userId: Types.ObjectId | IUser; // Raiser
    name: string;
    email?: string;
    mobile?: string;
    role: 'patient' | 'doctor' | 'nurse' | 'staff' | 'helpdesk' | 'masterhelpdesk' | 'hospital-admin' | 'super-admin' | 'lab' | 'pharma-owner' | 'ambulance' | 'admin' | 'DISCHARGE' | 'emergency';
    sourceModule?: string; // e.g., 'OPD', 'Pharmacy', 'Inventory'
    subject: string;
    message: string;
    type: 'feedback' | 'complaint' | 'bug' | 'other'; // Ticket type
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    status: 'open' | 'in-progress' | 'resolved';
    assignedTo?: Types.ObjectId | IUser; // Support Agent
    attachments: string[];
    replies: IReply[];
    internalNotes: IInternalNote[];
    hospital: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

import { TenantRequest } from '../../middleware/tenantMiddleware.js';

export interface SupportRequestRequest extends TenantRequest {
    user?: IUser;
    files?: Express.Multer.File[] | { [key: string]: Express.Multer.File[] } | any; // Type for multer files
}
