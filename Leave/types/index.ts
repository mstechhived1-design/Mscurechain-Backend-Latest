import { Document, Types } from 'mongoose';
import { Request } from 'express';

import { IUser } from '../../Auth/types/index.js';

export interface ILeave extends Document {
    requester: Types.ObjectId | IUser;
    startDate: Date;
    endDate: Date;
    reason: string;
    assignedHelpdesk?: Types.ObjectId | IUser; // Keeping for reference if needed, but hospital-admin will be the primary controller
    hospital?: Types.ObjectId;
    leaveType: 'sick' | 'casual' | 'emergency' | 'maternity' | 'other';
    status: 'pending' | 'approved' | 'rejected';
    createdAt: Date;
}

export interface LeaveRequest extends Request {
    user?: IUser;
}
