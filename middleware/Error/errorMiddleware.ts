import { Request, Response, NextFunction } from "express";
import ApiError from "../../utils/ApiError.js";

const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

const notFound = (req: Request, res: Response, next: NextFunction) => {
    next(new ApiError(404, `Not Found - ${req.originalUrl}`));
};

import { logError } from "../../utils/logger.js";

const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // ✅ Centralized Error Tracking
    logError(`API Error: ${req.method} ${req.originalUrl}`, err, {
        statusCode,
        ip: req.ip,
        requestId: (req as any).requestId
    });

    const payload: any = {
        success: false,
        message,
    };

    if (err.details) payload.details = err.details;
    if (process.env.NODE_ENV === "development" && err.stack) payload.stack = err.stack;

    res.status(statusCode).json(payload);
};

export default asyncHandler;
export { notFound, errorHandler };
