import { Document, Types } from "mongoose";

export interface IBed extends Document {
  bedId: string;
  type: string;
  floor: string;
  room: string;
  department?: string;
  ward?: string;
  status: "Vacant" | "Occupied" | "Cleaning" | "Blocked";
  pricePerDay: number; // Daily rate for the bed
  pricePerHalfDay?: number;
  pricePerHour?: number;
  hospital: Types.ObjectId;
}

export interface IIPDAdmission extends Document {
  admissionId: string;
  patient: Types.ObjectId;
  globalPatientId?: Types.ObjectId;
  primaryDoctor: Types.ObjectId;
  admissionDate: Date;
  dischargeDate?: Date;
  admissionType: string;
  status: "Active" | "Discharged" | "Discharge Initiated";
  diet?: string;
  clinicalNotes?: string;
  reason?: string; // Primary symptoms/reason for admission
  vitals?: {
    height?: string;
    weight?: string;
    bloodPressure?: string;
    temperature?: string;
    pulse?: string;
    spO2?: string;
    respiratoryRate?: string;
    glucose?: string;
    glucoseType?: "Fasting" | "After Meal" | "Random";
    status?: "Stable" | "Warning" | "Critical";
    condition?: string;
    notes?: string;
    lastVitalsRecordedAt?: Date;
    nextVitalsDue?: Date;
  };
  hospital: Types.ObjectId;

  // Billing Fields
  amount?: number; // Total amount paid or base amount
  totalBilledAmount?: number; // Aggregate of all charges
  advancePaid?: number; // Sum of all advance payments
  settlementPaid?: number; // Sum of all settlement payments
  balanceDue?: number; // Outstanding amount (Charges - Settlements)
  discountDetails?: {
    amount: number;
    reason: string;
    approvedBy: Types.ObjectId;
  };
  isBillLocked?: boolean; // Post-settlement lock
  billLockedAt?: Date;
  billLockedBy?: Types.ObjectId;
  paymentMethod?: string;
  paymentStatus?: "pending" | "paid" | "failed" | "not_required";
  pharmacyClearanceStatus?: "NOT_REQUIRED" | "PENDING" | "CLEARED";

  dischargeRequested?: boolean;
  dischargeRequestedAt?: Date;
  dischargeRequestedBy?: Types.ObjectId;
  transferRequested?: boolean;
  transferRequestedAt?: Date;
  transferRequestedBy?: Types.ObjectId;
  transferInstructions?: {
    roomType?: string;
    room?: string;
    bed?: string;
    targetBedId?: string;
    notes?: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IBedOccupancy extends Document {
  bed: Types.ObjectId;
  admission: Types.ObjectId;
  startDate: Date;
  endDate?: Date;
  hospital: Types.ObjectId;
  dailyRateAtTime?: number; // Snapshot of price when admission started
  halfDayRateAtTime?: number;
  hourlyRateAtTime?: number;
}

export interface IIPDExtraCharge extends Document {
  patient: Types.ObjectId;
  globalPatientId?: Types.ObjectId;
  admission: Types.ObjectId;
  hospital: Types.ObjectId;
    category:
    | "Nursing"
    | "Doctor Fee"
    | "OT"
    | "Radiology"
    | "Pharmacy"
    | "Medicine"
    | "Diagnostics"
    | "Consumables"
    | "Lab"
    | "Misc";
  description: string;
  amount: number;
  date: Date;
  addedBy: Types.ObjectId;
  status: "Active" | "Reversed";
  reversalReason?: string;
}

export interface IIPDAdvancePayment extends Document {
  patient: Types.ObjectId;
  globalPatientId?: Types.ObjectId;
  admission: Types.ObjectId;
  hospital: Types.ObjectId;
  amount: number;
  mode: "Cash" | "Card" | "Bank Transfer" | "Cheque" | "Digital Wallet" | "Insurance" | "Corporate/Sponsor" | "Mixed" | "UPI";
  reference?: string;
  transactionType: "Advance" | "Interim Payment" | "Refund" | "Settlement" | "Due Recovery";
  date: Date;
  receivedBy: Types.ObjectId;
  transactionId?: string;
  receiptNumber?: string;
  isEdited?: boolean;
  editReason?: string;
  editedAt?: Date;
  editedBy?: Types.ObjectId;
  paymentDetails?: {
    cash?: number;
    upi?: number;
    card?: number;
    bankTransfer?: number;
  };
}

export interface IRoom extends Document {
  roomId: string;
  type: "ICU" | "General" | "Private" | "Semi-Private" | "Emergency";
  floor: string;
  department?: string;
  hospital: Types.ObjectId;
  isActive: boolean;
}

export interface IIPDDepartment extends Document {
  name: string;
  description?: string;
  headOfDepartment?: string;
  hospital: Types.ObjectId;
  isActive: boolean;
}

export interface IVitalsThreshold extends Document {
  hospital: Types.ObjectId;
  wardType: string;
  thresholds: {
    heartRate: {
      minPossible: number;
      maxPossible: number;
      lowCritical: number;
      lowWarning: number;
      highWarning: number;
      highCritical: number;
    };
    spO2: {
      minPossible: number;
      maxPossible: number;
      lowCritical: number;
      lowWarning: number;
      highWarning: number;
      highCritical: number;
    };
    systolicBP: {
      minPossible: number;
      maxPossible: number;
      lowCritical: number;
      lowWarning: number;
      highWarning: number;
      highCritical: number;
    };
    diastolicBP: {
      minPossible: number;
      maxPossible: number;
      lowCritical: number;
      lowWarning: number;
      highWarning: number;
      highCritical: number;
    };
    temperature: {
      minPossible: number;
      maxPossible: number;
      lowCritical: number;
      lowWarning: number;
      highWarning: number;
      highCritical: number;
    };
    respiratoryRate: {
      minPossible: number;
      maxPossible: number;
      lowCritical: number;
      lowWarning: number;
      highWarning: number;
      highCritical: number;
    };
    glucose: {
      fasting: {
        minPossible: number;
        maxPossible: number;
        lowCritical: number;
        lowWarning: number;
        highWarning: number;
        highCritical: number;
      };
      afterMeal: {
        minPossible: number;
        maxPossible: number;
        lowCritical: number;
        lowWarning: number;
        highWarning: number;
        highCritical: number;
      };
      random: {
        minPossible: number;
        maxPossible: number;
        lowCritical: number;
        lowWarning: number;
        highWarning: number;
        highCritical: number;
      };
    };
  };
  monitoringFrequency: {
    critical: number; // hours
    warning: number; // hours
  };
  isActive: boolean;
}

export interface IVitalsAlert extends Document {
  patient: Types.ObjectId;
  globalPatientId?: Types.ObjectId;
  admission: Types.ObjectId;
  vitalsRecord: Types.ObjectId;
  hospital: Types.ObjectId;
  assignedDoctor: Types.ObjectId;
  severity: "Warning" | "Critical";
  vitalName: string;
  value: number;
  thresholdValue: number;
  status: "Active" | "Acknowledged" | "Resolved";
  isEscalated?: boolean;
  auditLog: Array<{
    action: string;
    user: Types.ObjectId;
    timestamp: Date;
    notes?: string;
  }>;
}
