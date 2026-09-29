import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import SuperAdmin from "../Models/SuperAdmin.js";
import { handleAuthResponse } from "./authController.js";
import {
    recordFailedAttempt,
    clearFailedAttempts,
} from "../../middleware/Auth/loginSecurity.js";
import { validationResult } from "express-validator";

// ─── SECURITY CONSTANTS (from .env) ──────────────────────────────────────────
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || "12", 10);

/**
 * Super Admin Registration
 * Requires secret key validation from .env (accepted only via request body, NOT URL)
 * ✅ SECURITY: Secret key is validated with timing-safe comparison
 */
export const registerSuperAdmin = async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
        return res.status(422).json({ errors: errors.array() });

    try {
        const { name, email, mobile, password, secretKey } = req.body;
        const systemSecret = process.env.SUPER_ADMIN_SECRET_KEY;

        if (!systemSecret) {
            console.error(
                "[SECURITY] SUPER_ADMIN_SECRET_KEY not configured in environment",
            );
            return res.status(500).json({
                success: false,
                message: "System configuration error. Contact administrator.",
            });
        }

        // ✅ SECURITY: Timing-safe comparison to prevent timing attacks
        if (!secretKey || secretKey.length !== systemSecret.length) {
            console.warn(
                `[SECURITY] Super Admin registration attempt with invalid secret key from IP: ${req.ip}`,
            );
            return res.status(403).json({
                success: false,
                message: "Access Denied: Invalid security credentials.",
            });
        }

        const isValidSecret = crypto.timingSafeEqual(
            Buffer.from(String(secretKey)),
            Buffer.from(systemSecret),
        );

        if (!isValidSecret) {
            console.warn(
                `[SECURITY] Super Admin registration attempt with WRONG secret key from IP: ${req.ip}`,
            );
            return res.status(403).json({
                success: false,
                message: "Access Denied: Invalid security credentials.",
            });
        }

        if (!name || !email || !password) {
            return res
                .status(400)
                .json({ message: "Name, email and password are required" });
        }

        const existingSA = await SuperAdmin.findOne({
            email: email.toLowerCase(),
        });
        if (existingSA) {
            return res
                .status(400)
                .json({ message: "Super Admin already exists with this email" });
        }

        const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
        const newSA = await SuperAdmin.create({
            name,
            email: email.toLowerCase(),
            mobile,
            password: hashedPassword,
            role: "super-admin",
            status: "active",
        });

        const { accessToken, csrfToken } = await handleAuthResponse(res, newSA, req);

        res.status(201).json({
            message: "Super Admin registered successfully",
            accessToken,
            csrfToken,
            user: {
                id: newSA._id.toString(),
                name: newSA.name,
                email: newSA.email,
                role: "super-admin",
            },
        });
    } catch (error: any) {
        console.error("[registerSuperAdmin] Error:", error);
        const errorMessage =
            process.env.NODE_ENV === "production"
                ? "Registration failed"
                : error.message;
        res.status(500).json({ message: "Server error", error: errorMessage });
    }
};

/**
 * Super Admin Login
 * ✅ SECURITY: Requires secret key (timing-safe comparison)
 * ✅ SECURITY: Brute-force protection via account lockout
 * ✅ SECURITY: Account status verification
 */
export const loginSuperAdmin = async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
        return res.status(422).json({ errors: errors.array() });

    try {
        const { loginId, email, mobile, password, secretKey } = req.body;
        const systemSecret = process.env.SUPER_ADMIN_SECRET_KEY;

        if (!systemSecret) {
            console.error(
                "[SECURITY] SUPER_ADMIN_SECRET_KEY not configured in environment",
            );
            return res.status(500).json({
                success: false,
                message: "System configuration error",
            });
        }

        // ✅ SECURITY: Timing-safe secret key comparison
        if (!secretKey || secretKey.length !== systemSecret.length) {
            console.warn(
                `[SECURITY] Super Admin login attempt with invalid secret key from IP: ${req.ip}`,
            );
            return res.status(403).json({
                success: false,
                message: "Access Denied: Invalid security credentials.",
            });
        }

        const isValidSecret = crypto.timingSafeEqual(
            Buffer.from(String(secretKey)),
            Buffer.from(systemSecret),
        );

        if (!isValidSecret) {
            console.warn(
                `[SECURITY] Super Admin login attempt with WRONG secret key from IP: ${req.ip}`,
            );
            return res.status(403).json({
                success: false,
                message: "Access Denied: Invalid security credentials.",
            });
        }

        const identifier = loginId || email || mobile;

        if (!identifier || !password) {
            return res.status(400).json({
                message: "Login ID (email or mobile) and password are required",
            });
        }

        const superAdmin = await SuperAdmin.findOne({
            $or: [
                { email: identifier.toLowerCase() },
                { mobile: identifier },
            ],
        });

        if (!superAdmin) {
            // ✅ SECURITY: Use generic message to prevent user enumeration
            await recordFailedAttempt(`sa:${identifier}`);
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // ✅ SECURITY: Check account status before password validation
        if (superAdmin.status !== "active") {
            return res.status(403).json({ message: "Account is suspended" });
        }

        const isMatch = await bcrypt.compare(
            password,
            superAdmin.password as string,
        );

        if (!isMatch) {
            const { locked, attempts } = await recordFailedAttempt(
                `sa:${identifier}`,
            );
            if (locked) {
                return res.status(429).json({
                    message:
                        "Account temporarily locked due to too many failed login attempts. Try again in 15 minutes.",
                });
            }
            // Next lockout threshold is 5; compute remaining attempts
            const nextThreshold = 5;
            const attemptsRemaining = Math.max(0, nextThreshold - attempts);
            return res.status(401).json({
                message: "Invalid credentials",
                ...(attemptsRemaining <= 2 && attemptsRemaining > 0
                    ? {
                        warning: `${attemptsRemaining} attempt(s) remaining before account is locked`,
                    }
                    : {}),
            });
        }

        // ✅ SECURITY: Clear failed attempts on success
        await clearFailedAttempts(`sa:${identifier}`);

        // ✅ SuperAdmin PIN Verification (replaces email-based 2FA)
        const pin = "6666"; // Static 4-digit PIN
        const pinExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

        superAdmin.otp = pin;
        superAdmin.otpExpiresAt = pinExpiresAt;
        superAdmin.otpAttempts = 0;
        await superAdmin.save();

        const jwt = (await import("jsonwebtoken")).default;
        const tempToken = jwt.sign(
            { _id: superAdmin._id, role: "super-admin", purpose: "2fa" },
            process.env.JWT_SECRET as string,
            { expiresIn: "30m" }
        );

        res.json({
            require2FA: true,
            pinLength: 4,
            tempToken,
            message: "Enter your 4-digit security PIN to continue"
        });
    } catch (error: any) {
        console.error("[loginSuperAdmin] Error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

/**
 * Verify SuperAdmin OTP
 */
export const verifySuperAdminOtp = async (req: Request, res: Response) => {
    const { otp, tempToken } = req.body;

    if (!otp || !tempToken) {
        return res.status(400).json({ message: "OTP and temporary token are required" });
    }

    try {
        const jwt = (await import("jsonwebtoken")).default;
        const decoded = jwt.verify(tempToken, process.env.JWT_SECRET as string) as any;

        if (!decoded || decoded.role !== "super-admin" || decoded.purpose !== "2fa") {
            return res.status(401).json({ message: "Invalid or expired session. Please login again." });
        }

        const superAdmin = await SuperAdmin.findById(decoded._id);
        if (!superAdmin) {
            return res.status(404).json({ message: "Super Admin not found" });
        }

        if (superAdmin.otp !== otp) {
            superAdmin.otpAttempts = (superAdmin.otpAttempts || 0) + 1;
            await superAdmin.save();

            if (superAdmin.otpAttempts >= 5) {
                superAdmin.otp = undefined;
                superAdmin.otpExpiresAt = undefined;
                await superAdmin.save();
                return res.status(429).json({ message: "Too many failed attempts. Please login again." });
            }

            return res.status(401).json({ message: "Invalid OTP" });
        }

        if (superAdmin.otpExpiresAt && superAdmin.otpExpiresAt < new Date()) {
            return res.status(401).json({ message: "OTP expired. Please resend." });
        }

        // OTP Valid - Clear it and return final tokens
        superAdmin.otp = undefined;
        superAdmin.otpExpiresAt = undefined;
        superAdmin.otpAttempts = 0;
        await superAdmin.save();

        await clearFailedAttempts(`sa:${superAdmin.email}`);

        const { accessToken, refreshToken, csrfToken } = await handleAuthResponse(res, superAdmin, req);

        return res.json({
            message: "2FA verified successfully",
            accessToken,
            refreshToken,
            csrfToken,
            tokens: { accessToken, refreshToken, csrfToken },
            user: {
                id: superAdmin._id.toString(),
                name: superAdmin.name,
                email: process.env.EMAIL_USER_FINAL || superAdmin.email,
                role: "super-admin",
            },
        });
    } catch (err: any) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Session expired. Please login again." });
        }
        console.error("OTP Verification Error:", err);
        return res.status(500).json({ message: "Server error during verification" });
    }
};

/**
 * Resend SuperAdmin PIN (no email needed)
 */
export const resendSuperAdminOtp = async (req: Request, res: Response) => {
    const { tempToken } = req.body;

    if (!tempToken) {
        return res.status(400).json({ message: "Temporary token is required" });
    }

    try {
        const jwt = (await import("jsonwebtoken")).default;
        const decoded = jwt.verify(tempToken, process.env.JWT_SECRET as string) as any;

        if (!decoded || decoded.role !== "super-admin" || decoded.purpose !== "2fa") {
            return res.status(401).json({ message: "Invalid or expired session. Please login again." });
        }

        const superAdmin = await SuperAdmin.findById(decoded._id);
        if (!superAdmin) {
            return res.status(404).json({ message: "Super Admin not found" });
        }

        // Reset PIN
        const pin = "6666";
        const pinExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

        superAdmin.otp = pin;
        superAdmin.otpExpiresAt = pinExpiresAt;
        superAdmin.otpAttempts = 0;
        await superAdmin.save();

        return res.json({ message: "PIN has been reset. Enter your 4-digit security PIN." });
    } catch (err: any) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Session expired. Please login again." });
        }
        console.error("PIN Reset Error:", err);
        return res.status(500).json({ message: "Server error during resend" });
    }
};

