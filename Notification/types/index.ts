import { Document, Types } from "mongoose";
import { Request } from "express";

import { IUser } from "../../Auth/types/index.js";

export interface INotification extends Document {
  hospital: Types.ObjectId;
  recipient: Types.ObjectId | any;
  recipientModel: "User" | "Patient";
  sender?: Types.ObjectId | any;
  senderModel?: "User" | "Patient";
  type: string; // e.g., 'appointment', 'message', 'alert'
  message: string;
  relatedId?: Types.ObjectId; // ID of the Appointment, Message, etc.
  isRead: boolean;
  createdAt: Date;
}

export interface NotificationRequest extends Request {
  user?: IUser;
}
