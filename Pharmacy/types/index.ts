import { AuthRequest } from "../../Auth/types/index.js";
import { IPharmaProfile } from "../Models/PharmaProfile.js";

export interface PharmaRequest extends AuthRequest {
    pharma?: IPharmaProfile;
}
