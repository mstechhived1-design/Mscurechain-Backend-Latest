import { Document, Types } from "mongoose";
import { Request } from "express";

import { IUser } from "../../Auth/types/index.js";
import { IAppointment } from "../../Appointment/types/index.js";

export interface IReport extends Document {
  appointment?: Types.ObjectId | IAppointment;
  patient: Types.ObjectId | IUser;
  doctor?: Types.ObjectId | IUser;
  name: string;
  type: string;
  url: string; // Cloudinary URL
  public_id: string; // Cloudinary public_id
  description?: string;
  generatedBy: "doctor" | "system" | "lab";
  date: Date;
  hospital: Types.ObjectId;
}

export interface ReportRequest extends Request {
  user?: IUser;
  file?: any; // For multerm
}
