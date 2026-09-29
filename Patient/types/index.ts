import { Document, Types } from 'mongoose';
import { Request } from 'express';
import { IUser } from '../../Auth/types/index.js';

export interface IPatientProfile extends Document {
    user: Types.ObjectId | IUser;
    hospital?: Types.ObjectId; // Fixed single hospital reference
    mrn?: string;
    honorific?: string;
    lastVisit?: Date;
    medicalHistory?: string;
    contactNumber?: string;
    emergencyContactEmail?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    emergencyContactRelation?: string;
    GuardianName?: string;
    GuardianRelation?: string;
    GuardianMobile?: string;
    doctorReference?: string;
    dob?: Date;
    gender?: 'male' | 'female' | 'other';
    address?: string;
    alternateNumber?: string; // Previously emergency contact
    conditions?: string;
    allergies?: string;
    medications?: string;
    height?: string;
    weight?: string;
    bloodPressure?: string;
    temperature?: string;
    pulse?: string;
    spO2?: string;
    glucose?: string;
    glucoseType?: 'Fasting' | 'After Meal' | 'Random';
    sugar?: string;
    maritalStatus?: 'Single' | 'Married' | 'Divorced' | 'Widowed';
    bloodGroup?: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
    condition?: string;
    notes?: string;
    bio?: string;
    age?: number; // Virtual
    createdAt: Date;
    updatedAt: Date;
}

export interface PatientRequest extends Request {
    user?: IUser;
}
