import { Document, Types } from 'mongoose';
import { Request } from 'express';

import { IUser } from '../../Auth/types/index.js';
import { IAppointment } from '../../Appointment/types/index.js';

export interface IPrescription extends Document {
    appointment?: Types.ObjectId | IAppointment;
    doctor: Types.ObjectId | IUser;
    patient: Types.ObjectId | IUser;
    medicines?: string[];
    diet_advice?: string[];
    suggested_tests?: string[];
    follow_up?: string;
    avoid?: string[];
    signature?: string;
    symptoms?: string;
    matchedSymptoms?: string[];
    notes?: string;
    reason?: string;
    date: Date;
}

export interface PrescriptionRequest extends Request {
    user?: IUser;
}
