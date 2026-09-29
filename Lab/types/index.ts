import { Document, Types } from "mongoose";
import { IUser } from "../../Auth/types/index.js";

export interface IDepartment extends Document {
  name: string;
  description?: string;
  isActive: boolean;
}

export interface ILabTest extends Document {
  testName: string;
  name: string;
  universalTestId?: Types.ObjectId;
  priceReviewRequired?: boolean;
  testCode?: string;
  code?: string;
  departmentId: Types.ObjectId | IDepartment;
  departmentIds?: (Types.ObjectId | IDepartment)[];
  testGroupId?: Types.ObjectId | ITestGroup;
  isProfile?: boolean;
  category?: string;
  price: number;
  labPrice?: number; // Optional Lab-to-Lab discounted price
  sampleType: string;
  unit?: string;
  method?: string;
  turnaroundTime?: string;
  normalRanges?: {
    male: { min: number; max: number };
    female: { min: number; max: number };
    child: { min: number; max: number };
  };
  // Dynamic Result Parameters
  resultParameters?: {
    label: string;
    unit?: string;
    normalRange?: string;
    normalRanges?: {
      male?: { min?: number; max?: number; text?: string };
      female?: { min?: number; max?: number; text?: string };
      child?: { min?: number; max?: number; text?: string };
      newborn?: { min?: number; max?: number; text?: string };
      infant?: { min?: number; max?: number; text?: string };
      geriatric?: { min?: number; max?: number; text?: string };
    };
    remarks?: string;
    example?: string;
    fieldType?: "text" | "number" | "boolean";
    isRequired?: boolean;
    displayOrder?: number;
  }[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITestGroup extends Document {
  name: string;
  departmentId: Types.ObjectId | IDepartment;
  description?: string;
  displayOrder: number;
  isProfile: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRange {
  min?: number;
  max?: number;
  text?: string;
}

export interface ITestParameter extends Document {
  testId: Types.ObjectId | ILabTest;
  name: string;
  unit?: string;
  normalRanges: {
    male: IRange;
    female: IRange;
    child: IRange;
    newborn: IRange;
  };
  criticalLow?: string | number;
  criticalHigh?: string | number;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILabOrder extends Document {
  patient: Types.ObjectId | IUser;
  globalPatientId?: Types.ObjectId;
  doctor: Types.ObjectId | IUser;
  referredBy?: Types.ObjectId | IUser;
  hospital?: Types.ObjectId;
  tokenNumber?: string;
  sampleId?: string;
  prescription?: Types.ObjectId;
  admission?: Types.ObjectId;
  priority?: string;
  clinicalAnnotations?: string;
  tests: {
    _id: Types.ObjectId;
    test: Types.ObjectId | ILabTest;
    status: "pending" | "processing" | "completed";
    result?: string;
    remarks?: string;
    isAbnormal?: boolean;
    subTests?: {
      name: string;
      result: string;
      unit: string;
      range: string;
    }[];
  }[];
  status: "prescribed" | "sample_collected" | "processing" | "completed";
  detailedStatus?:
    | "Ordered"
    | "Collected"
    | "Received"
    | "Processing"
    | "Verified"
    | "Approved"
    | "Delivered";
  subtotal?: number;
  discountAmount?: number;
  discountReason?: string;
  totalAmount: number;
  paymentStatus: "pending" | "paid";
  invoiceId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  sampleCollectedAt?: Date;
  resultsEnteredAt?: Date;
  completedAt?: Date;
  doctorNotified?: boolean;
  isEdited?: boolean;
  editReason?: string;
  editedAt?: Date;
  editedBy?: Types.ObjectId;
}
