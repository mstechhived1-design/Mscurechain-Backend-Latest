import { Document, Types } from "mongoose";
import { Request } from "express";
import { IUser } from "../../Auth/types/index.js";
import { IHospital } from "../../Hospital/types/index.js";

export interface IMasterHelpdesk extends Document {
  name: string;
  email: string;
  mobile: string;
  user?: Types.ObjectId | IUser;
  password?: string;
  hospital?: Types.ObjectId | IHospital;
  refreshTokens?: {
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }[];
  resetPasswordToken?: string;
  resetPasswordExpire?: Date;
  status: "active" | "suspended";
  role?: string;
  assignedStaff?: Types.ObjectId;
  loginId?: string;
  additionalNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MasterHelpdeskRequest extends Request {
  user?: IUser;
  hospitalId?: Types.ObjectId | string;
  tenantId?: Types.ObjectId | string;
}
