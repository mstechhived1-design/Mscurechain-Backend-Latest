import { Request } from "express";
import { Document, Types } from "mongoose";

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  mobile?: string;
  email?: string;
  password?: string;
  role:
  | "doctor"
  | "helpdesk"
  | "masterhelpdesk"
  | "hospital-admin"
  | "lab"
  | "staff"
  | "pharma-owner"
  | "admin"
  | "nurse"
  | "ambulance"
  | "emergency"
  | "hr";
  hospital?: Types.ObjectId;
  doctorId?: string;
  age?: number;
  ageUnit?: "Years" | "Months" | "Days";
  gender?: "Male" | "Female" | "Other" | "male" | "female" | "other";
  resetPasswordToken?: string;
  resetPasswordExpire?: Date;
  status: "active" | "suspended" | "inactive";
  avatar?: string;
  dateOfBirth?: Date;
  consentGiven: boolean;
  consentTimestamp?: Date;
  createdAt: Date;
  updatedAt: Date;

  // Multi-device support
  refreshTokens: {
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }[];

  // Pharmacy / Shop Details
  shopName?: string;
  address?: any;
  gstin?: string;
  licenseNo?: string;
  image?: string;
  employeeId?: string;
  department?: string;
  pharmacyTerms?: string[];

  // HelpDesk specific
  assignedStaff?: Types.ObjectId;
  loginId?: string;
  additionalNotes?: string;
}

export interface ISuperAdmin extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  mobile?: string;
  password?: string;
  role: "super-admin";
  resetPasswordToken?: string;
  resetPasswordExpire?: Date;
  status: "active" | "suspended";
  createdAt: Date;
  updatedAt: Date;

  // Multi-device support
  refreshTokens: {
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }[];

  // 2FA Fields
  otp?: string;
  otpExpiresAt?: Date;
  otpAttempts?: number;
}

export interface IPatient extends Document {
  _id: Types.ObjectId;
  name: string;
  email?: string;
  mobile: string;
  password?: string;
  role: "patient";
  hospitals?: Types.ObjectId[];
  resetPasswordToken?: string;
  resetPasswordExpire?: Date;
  status: "active" | "suspended" | "inactive";
  honorific?: string;
  gender?: "Male" | "Female" | "Other" | "male" | "female" | "other";
  age?: number;
  ageUnit?: "Years" | "Months" | "Days";
  dateOfBirth?: Date;
  createdAt: Date;
  updatedAt: Date;

  // Multi-device support
  refreshTokens: {
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }[];

  // Global Clinical Data
  height?: number;
  weight?: number;
  bloodGroup?: string;
  address?: string;
  allergies?: string;
  conditions?: string;

  // Global Emergency Information
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
}

export interface IOTP extends Document {
  mobile: string;
  otpHash: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthRequest extends Request {
  user?: IUser | IPatient | ISuperAdmin | any; // 'any' for HelpDesk fallback compatibility until HelpDesk is typed
  helpDesk?: any;
}
