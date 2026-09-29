import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { validationResult } from "express-validator";
import AmbulancePersonnel from "../Models/AmbulancePersonnel.js";
import { EmergencyAuthRequest } from "../types/index.js";
import { handleAuthResponse } from "../../Auth/Controllers/authController.js";
import { tokenService } from "../../Auth/Services/tokenService.js";
import {
    recordFailedAttempt,
    clearFailedAttempts,
} from "../../middleware/Auth/loginSecurity.js";

// Login
export const login = async (req: Request, res: Response) => {
    console.log("🚑 Emergency Login Attempt:", {
        identifier: req.body.identifier,
        hasPassword: !!req.body.password
    });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }

    const { identifier: rawIdentifier, password } = req.body;
    const identifier = rawIdentifier?.toString()?.trim();

    if (!identifier || !password) {
        return res.status(400).json({
            message: "Employee ID/Mobile and password are required"
        });
    }

    const hospitalId = (req.headers["x-hospital-id"] || req.body.hospitalId || "global").toString();

    try {
        const personnel = await (AmbulancePersonnel.findOne({
            $or: [{ employeeId: identifier }, { mobile: identifier }],
        }) as any).unscoped().populate('hospital', 'name');

        if (!personnel) {
            await recordFailedAttempt(identifier, hospitalId);
            return res.status(401).json({
                message: `Identity '${identifier}' not recognized in dispatch registry`
            });
        }

        if (personnel.status === "suspended") {
            return res.status(401).json({
                message: "Your mission credentials have been suspended. Contact HQ."
            });
        }

        const match = await bcrypt.compare(password, personnel.password);
        if (!match) {
            const { attempts, locked, lockDuration } = await recordFailedAttempt(identifier, hospitalId);
            if (locked) {
                const mins = Math.ceil(lockDuration / 60);
                return res.status(429).json({
                    message: `Account temporarily locked due to too many failed attempts. Try again in ${mins} minute(s).`,
                    retryAfterSeconds: lockDuration
                });
            }
            return res.status(401).json({ message: "Security Authentication Failed: Invalid Password" });
        }

        await clearFailedAttempts(identifier, hospitalId);

        // Standardize role for TokenService
        const authDoc = personnel as any;
        authDoc.role = "ambulance";
        // Ensure hospitals array exists even for personnel tied to a single hospital
        authDoc.hospitals = personnel.hospital ? [(personnel.hospital as any)._id || personnel.hospital] : [];

        const { accessToken, csrfToken } = await handleAuthResponse(res, authDoc, req, hospitalId);


        console.log("✅ SESSION INITIATED for:", personnel.employeeId);

        return res.json({
            accessToken,
            refreshToken: undefined, // in cookie
            tokens: {
                accessToken,
                refreshToken: undefined // in cookie
            },
            csrfToken,
            user: {
                id: personnel._id,
                name: personnel.name,
                role: "ambulance",
                employeeId: personnel.employeeId,
                vehicleNumber: personnel.vehicleNumber,
                status: personnel.status,
                hospital: personnel.hospital
            },
        });
    } catch (err: any) {
        console.error("💥 Emergency login error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

// Refresh Token (Centralized logic via cookies)
export const refresh = async (req: Request, res: Response) => {
    const oldRefreshToken = req.cookies.refreshToken;
    
    if (!oldRefreshToken)
        return res.status(401).json({ message: "No refresh token provided" });

    try {
        const payload = tokenService.verifyRefreshToken(oldRefreshToken);
        const { _id: userId } = payload;

        const personnel = await (AmbulancePersonnel.findById(userId) as any).unscoped();
        if (!personnel || personnel.status !== "active") {
            tokenService.clearCookies(res);
            return res.status(401).json({ message: "Account unavailable" });
        }

        const hashedOld = tokenService.hashToken(oldRefreshToken);
        const now = new Date();
        
        // Auto-cleanup while searching
        const validTokens = (personnel.refreshTokens || []).filter((t: any) => new Date(t.expiresAt) > now);
        const currentTokenValid = validTokens.find((t: any) => t.tokenHash === hashedOld);

        if (!currentTokenValid) {
            personnel.refreshTokens = validTokens;
            await personnel.save();
            tokenService.clearCookies(res);
            return res.status(401).json({ message: "Invalid session" });
        }

        personnel.refreshTokens = validTokens;
        await personnel.save();

        const { accessToken } = tokenService.generateTokens({
            _id: userId,
            role: "ambulance",
            hospitalId: payload.hospitalId,
            hospitals: payload.hospitals
        });

        tokenService.setAccessCookie(res, accessToken, payload.hospitalId, "ambulance");

        return res.json({ 
            accessToken, 
            csrfToken: req.cookies.csrf_token || req.headers["x-csrf-token"],
            accessTokenExpiresIn: tokenService.getAccessExpirySeconds()
        });
    } catch (err) {
        tokenService.clearCookies(res);
        res.status(401).json({ message: "Invalid session" });
    }
};

export const logout = async (req: Request, res: Response) => {
    const refreshToken = req.cookies.refreshToken;
    
    if (refreshToken) {
        try {
            const payload = tokenService.verifyRefreshToken(refreshToken);
            const hashedToken = tokenService.hashToken(refreshToken);

            await (AmbulancePersonnel.updateOne(
                { _id: payload._id },
                { $pull: { refreshTokens: { tokenHash: hashedToken } } }
            ) as any).unscoped();

            tokenService.clearCookies(res);
            res.status(204).send();
        } catch (err) {
            tokenService.clearCookies(res);
            res.status(204).send();
        }
    } else {
        tokenService.clearCookies(res);
        res.status(204).send();
    }
};

// Get current user
export const me = async (req: EmergencyAuthRequest, res: Response) => {
    // Ensure the role is always present in the response
    const userRole = (req.ambulancePersonnel as any).role || "ambulance";
    res.json({ 
        user: { 
            ...req.ambulancePersonnel?.toObject(),
            role: userRole
        } 
    });
};
