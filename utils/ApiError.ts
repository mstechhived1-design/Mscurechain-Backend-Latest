class ApiError extends Error {
    public statusCode: number;
    public isOperational: boolean;
    public details: any;

    constructor(statusCode: number = 500, message: string = "Internal Server Error", details: any = null) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}

export default ApiError;
