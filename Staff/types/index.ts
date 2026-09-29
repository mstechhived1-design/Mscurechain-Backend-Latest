import { Document, Types } from "mongoose";
import { IUser } from "../../Auth/types/index.js";

export interface IStaffProfile extends Document {
  user: Types.ObjectId;
  hospital: Types.ObjectId;

  // Professional
  honorific?: 'Mr' | 'Mrs' | 'Ms' | 'Dr';
  department?: string | string[];
  assignedRoom?: string | string[];
  designation?: string;
  employeeId?: string;
  employmentType: "full-time" | "part-time" | "contract";
  experienceYears?: number;
  joiningDate?: Date;

  // Contact
  address?: {
    street: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  emergencyContact?: {
    name: string;
    mobile: string;
    relationship: string;
  };
  bloodGroup?: string;

  // Work Schedule
  shift: Types.ObjectId | any | null;
  workingHours: {
    start: string;
    end: string;
  };
  shiftStart: string; // Legacy
  shiftEnd: string; // Legacy
  weeklyOff: string[];

  // Qualifications
  qualifications: string[];
  certifications: string[];
  skills: string[];
  languages: string[];

  // Qualification Details & Documents
  qualificationDetails?: {
    registrationNumber?: string;
    licenseValidityDate?: Date;
    qualifications?: string[];
  };
  documents?: {
    degreeCertificate?: { url: string; publicId: string };
    medicalCouncilRegistration?: { url: string; publicId: string };
    nursingCouncilRegistration?: { url: string; publicId: string };
  };
  expiryAlertsSent?: {
    thirtyDay: boolean;
    sevenDay: boolean;
    oneDay: boolean;
    expired: boolean;
  };

  // Extras
  notes?: string;
  bio?: string;
  qrSecret: string;
  status: "active" | "inactive" | "suspended" | "terminated";
  terminationDate?: Date;
  terminationReason?: string;
  // Leave Quotas (Monthly)
  sickLeaveQuota: number;
  emergencyLeaveQuota: number;

  // Financial & Identity
  panNumber?: string;
  pfNumber?: string;
  esiNumber?: string;
  uanNumber?: string;
  aadharNumber?: string;
  fatherName?: string;
  dob?: Date;
  workLocation?: string;
  gender?: string;

  // Salary & Payroll Info
  baseSalary: number;
  allowances: {
    type: string;
    amount: number;
  }[];
  deductions: {
    type: string;
    amount: number;
  }[];
  bankDetails?: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    ifscCode: string;
  };
  quickNotes?: {
    text: string;
    timestamp: Date;
  }[];

  createdAt: Date;
  updatedAt: Date;
}

export interface IPayroll extends Document {
  user: Types.ObjectId | IUser;
  hospital: Types.ObjectId;
  month?: number;
  year?: number;
  startDate?: Date;
  endDate?: Date;

  // Financial Overview
  baseSalary: number;
  totalAllowances: number;
  totalDeductions: number;
  netSalary: number;

  // Attendance Context
  attendanceDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  monthDays?: number;
  weeklyOffDays?: number;

  // Identity & Fiscal Context
  bankAccount?: string;
  panNumber?: string;
  pfNumber?: string;
  esiNumber?: string;
  uanNumber?: string;
  aadharNumber?: string;
  fatherName?: string;
  dob?: Date;
  gender?: string;
  workLocation?: string;
  designation?: string;
  department?: string;

  // Granular Breakdown (for High-Fidelity Payslip)
  breakdown?: {
    basic?: number;
    hra?: number;
    transportAllowance?: number;
    medicalAllowance?: number;
    specialAllowance?: number;
    salaryArrears?: number;
    bonus?: number;

    pf?: number;
    esi?: number;
    professionalTax?: number;
    salaryAdvance?: number;
    tds?: number;
  };

  // Employer Contribution (CTC)
  ctc?: {
    grossEarning?: number;
    pensionFund?: number;
    providentFund?: number;
    employerEsi?: number;
    totalCTC?: number;
  };

  status: "draft" | "processed" | "paid" | "cancelled";
  paymentDate?: Date;
  paymentMethod?: "bank_transfer" | "cash" | "check";
  transactionId?: string;
  payslipUrl?: string;
  notes?: string;
  processedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAttendance extends Document {
  user: Types.ObjectId | IUser;
  hospital: Types.ObjectId;
  date: Date;
  checkIn?: Date;
  checkOut?: Date;
  locationIn?: { lat: number; lng: number };
  locationOut?: { lat: number; lng: number };
  photoIn?: string;
  photoOut?: string;
  isAutoClockOut?: boolean;
  autoClockOutReason?: string;
  shiftName?: string;
  shiftStart?: string;
  shiftEnd?: string;
  status: "present" | "absent" | "late" | "half-day" | "on-leave" | "off-duty" | "auto-clock-out";
  isQrVerified: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
