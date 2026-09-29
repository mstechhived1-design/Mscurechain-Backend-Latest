// middleware/Utils/asyncHandler.ts
import { Request, Response, NextFunction } from "express";

export default function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any> | any) {
    return function (req: Request, res: Response, next: NextFunction) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
