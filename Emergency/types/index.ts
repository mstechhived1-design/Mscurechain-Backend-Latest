import { Request } from "express";
import { IAmbulancePersonnel } from "../Models/AmbulancePersonnel.js";

export interface EmergencyAuthRequest extends Request {
    ambulancePersonnel?: IAmbulancePersonnel;
}

export * from "../Models/AmbulancePersonnel.js";
export * from "../Models/EmergencyRequest.js";
