import { Document, Types } from "mongoose";
import { Request } from "express";
import { IUser } from "../../Auth/types/index.js";

export interface INote extends Document {
  doctor: Types.ObjectId | IUser;
  text: string;
  timestamp: Date;
  hospital: Types.ObjectId;
}

import { TenantRequest } from "../../middleware/tenantMiddleware.js";

export interface NoteRequest extends TenantRequest {
  user?: IUser;
}
