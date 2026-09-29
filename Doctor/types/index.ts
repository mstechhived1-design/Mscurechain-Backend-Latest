import { Document, Types } from "mongoose";
import { Request } from "express";

import { IUser, IPatient, ISuperAdmin } from "../../Auth/types/index.js";

export interface IAvailability {
  days: string[];
  startTime: string;
  breakStart?: string;
  breakEnd?: string;
  endTime: string;
}

export interface IQuickNote {
  text: string;
  timestamp: Date;
}

export interface IDoctorProfile extends Document {
  user: Types.ObjectId | IUser;
  assignedHelpdesk?: Types.ObjectId;
  hospital: Types.ObjectId; // Single hospital reference
  specialties?: string[];
  honorific?: 'Mr' | 'Mrs' | 'Ms' | 'Dr';
  consultationFee?: number;
  availability?: IAvailability[];
  qualifications?: string[];
  experienceStart?: Date;
  bio?: string;
  profilePic?: string;
  quickNotes?: IQuickNote[];
  medicalRegistrationNumber?: string;
  registrationCouncil?: string;
  registrationYear?: number;
  registrationExpiryDate?: Date;
  degreeCertificate?: string; // URL for Degree Certificate
  registrationCertificate?: string; // URL for Medical Council Registration
  doctorateCertificate?: string; // URL for Doctorate (New)
  internshipCertificate?: string; // URL for Internship (New)
  documents?: any;
  employeeId?: string;
  consultationDuration?: number;
  maxAppointmentsPerDay?: number;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  };
  permissions?: {
    canAccessEMR?: boolean;
    canAccessBilling?: boolean;
    canAccessLabReports?: boolean;
    canPrescribe?: boolean;
    canAdmitPatients?: boolean;
    canPerformSurgery?: boolean;
  };
  languages?: string[];
  awards?: string[];

  // Expiry Alert Flags
  expiryAlertsSent?: {
    thirtyDay?: boolean;
    sevenDay?: boolean;
    oneDay?: boolean;
    expired?: boolean;
  };

  // Salary & Payroll Info
  baseSalary?: number;
  panNumber?: string;
  aadharNumber?: string;
  pfNumber?: string;
  esiNumber?: string;
  uanNumber?: string;
  bankDetails?: {
    accountName?: string;
    accountNumber?: string;
    bankName?: string;
    ifscCode?: string;
  };
  allowances?: {
    type: string;
    amount: number;
  }[];
  deductions?: {
    type: string;
    amount: number;
  }[];

  experience?: string; // Virtual property
  isOnline?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DoctorRequest extends Request {
  user?: IUser | IPatient | ISuperAdmin | any; // or extend AuthRequest
}
