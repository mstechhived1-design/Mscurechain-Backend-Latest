import { Document, Types } from "mongoose";
import { Request } from "express";

import { IUser } from "../../Auth/types/index.js";

export interface IMessage extends Document {
  sender: Types.ObjectId | any;
  senderModel: "User" | "Patient";
  recipient: Types.ObjectId | any;
  recipientModel: "User" | "Patient";
  content?: string;
  type: "text" | "image" | "file";
  fileUrl?: string; // Optional if type is not file/image
  isRead: boolean;
  timestamp: Date;
  conversationId?: string; // Helper to group messages
  hospital: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRequest extends Request {
  user?: IUser;
}
