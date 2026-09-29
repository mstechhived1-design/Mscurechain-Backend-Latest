// Vercel serverless function entry point
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Request, Response } from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

import connectDB from "../config/db.js";
import { app } from "../app-serverless.js";

export default async function handler(req: Request, res: Response) {
    try {
        await connectDB();
    } catch (error: any) {
        console.error("Database connection error:", error);
        // In serverless, don't exit process, just return error response
        return res.status(500).json({
            error: "Database connection failed",
            message: error.message
        });
    }
    return app(req, res);
}