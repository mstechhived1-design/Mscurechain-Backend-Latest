import { IUser } from '../../Auth/types/index.js';
import { Request } from 'express';

export interface AdminRequest extends Request {
    user?: IUser;
}
