import { Request } from 'express';
import { IUser } from '../../Auth/types/index.js';

export interface SymptomCheckRequest extends Request {
    body: {
        symptoms: string[];
        duration?: string;
        age?: string | number;
        gender?: string;
        isEmergency?: boolean;
    };
}

export interface PrescriptionRequest extends Request {
    body: {
        symptoms: string[];
        patientDetails?: any;
    };
}
