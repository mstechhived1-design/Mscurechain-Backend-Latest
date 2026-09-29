

import { Request, Response, NextFunction } from "express";
import redisService from "../../config/redis.js";
import User from "../../Auth/Models/User.js";
import Patient from "../../Patient/Models/Patient.js";
import mongoose from "mongoose";

// ─── LOCKOUT CONFIGURATION ───────────────────────────────────────────────────
// These thresholds define when lockouts occur and for how long
// (Range-based logic implemented directly in recordFailedAttempt)

// Maximum attempts tracked before we stop incrementing (keep at max lockout)
const MAX_TRACKED_ATTEMPTS = 50; 
// How long the failure counter stays in Redis without new activity
const ATTEMPT_WINDOW_SECONDS = 24 * 60 * 60; // 24 hours (reset if inactive for a day)

/**
 * Extract the login identifier and hospitalId from the request.
 * If hospitalId is missing, it attempts to resolve it from the database.
 */
async function getLoginContext(req: Request): Promise<{ identifier: string | null; hospitalId: string; userId?: string }> {
    const body = req.body || {};
    const id = (
        body.mobile ||
        body.identifier ||
        body.logid ||
        body.loginId ||
        body.email ||
        ""
    ).toString().trim().toLowerCase();

    if (!id) return { identifier: null, hospitalId: "global" };

    // 1. Try to get hospital from request (headers/body)
    let hospitalId = (req.headers["x-hospital-id"] || body.hospitalId || "").toString().trim();
    let userId: string | undefined;

    // 2. Resolve hospital and user from DB (Zero-Input Multi-Tenancy)
    try {
        // Search User (Doctor/Staff/Admin)
        const user = await (User.findOne({
            $or: [
                { mobile: id },
                { email: id },
                { loginId: id },
                { doctorId: id }
            ]
        }) as any).unscoped();

        if (user) {
            userId = user._id.toString();
            if (!hospitalId || hospitalId === "global") {
                hospitalId = (user.hospital || (user.hospitals && user.hospitals[0]) || "global").toString();
            }
        } else {
            // Search Patient
            const patient = await (Patient.findOne({
                $or: [{ mobile: id }, { email: id }]
            }) as any).unscoped();
            
            if (patient) {
                userId = patient._id.toString();
                if (!hospitalId || hospitalId === "global") {
                    hospitalId = (patient.hospital || (patient.hospitals && patient.hospitals[0]) || "global").toString();
                }
            }
        }
    } catch (err) {
        console.error("[LoginSecurity] Resolution error:", err);
    }

    return { 
        identifier: id, 
        hospitalId: (hospitalId && hospitalId !== "global") ? hospitalId : "global",
        userId
    };
}

/**
 * Get Redis keys
 */
function getAttemptKey(hospitalId: string, identifier: string, userId?: string): string {
    // If we have a DB user ID, use it for perfect tracking across identifier changes
    const target = userId || identifier.replace(/\s+/g, '');
    return `login_fail:${hospitalId}:${target}`;
}

function getLockKey(hospitalId: string, identifier: string, userId?: string): string {
    const target = userId || identifier.replace(/\s+/g, '');
    return `auth:login_locked:${hospitalId}:${target}`;
}

/**
 * PRE-LOGIN middleware: Check if account is locked
 */
export const checkAccountLock = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const { identifier, hospitalId, userId } = await getLoginContext(req);
        
        if (!identifier) return next();

        const lockKey = getLockKey(hospitalId, identifier, userId);
        const remainingTTL = await redisService.ttl(lockKey);

        if (remainingTTL > 0) {
            const timeStr = remainingTTL < 60 
                ? `${remainingTTL} second(s)` 
                : `${Math.ceil(remainingTTL / 60)} minute(s)`;
            
            console.warn(
                `[LOGIN LOCK] Blocked attempt for: ${hospitalId}:${identifier}. Locked for another ${remainingTTL}s.`
            );

            return res.status(429).json({
                message: `Account temporarily locked due to too many failed login attempts. Try again in ${timeStr}.`,
                retryAfterSeconds: remainingTTL,
            });
        }

        next();
    } catch (err) {
        console.error("[LoginSecurity] Redis error on lock check:", err);
        // FIX: Fail-CLOSED in production — if Redis is down, block login attempts
        // This prevents brute-force attacks during Redis downtime
        if (process.env.NODE_ENV === "production") {
            console.error("[LoginSecurity] FAIL-CLOSED: Blocking login — Redis unavailable in production.");
            return res.status(503).json({
                message: "Authentication temporarily unavailable. Please try again shortly.",
            });
        }
        // Development: allow through
        next();
    }
};

/**
 * Record a FAILED login attempt.
 */
export const recordFailedAttempt = async (identifier: string, hospitalId: string = "global", userId?: string): Promise<{
    locked: boolean;
    lockDuration: number;
    attempts: number;
}> => {
    if (!identifier) return { locked: false, lockDuration: 0, attempts: 0 };

    const normalizedId = identifier.trim().toLowerCase();

    try {
        const attemptKey = getAttemptKey(hospitalId, identifier, userId);
        const count = await redisService.incr(attemptKey);

        // Refresh expiry window for the counter (24 hours)
        await redisService.expire(attemptKey, ATTEMPT_WINDOW_SECONDS);

        console.log(`[LOGIN FAIL] hospitalId: ${hospitalId}, identifier: ${normalizedId}, total attempts: ${count}`);

        /**
         * GRADUATED LOCKOUT LOGIC:
         * 1-4 attempts: No lock (User-friendly grace period)
         * 5-9 attempts: 30 sec lock
         * 10-14 attempts: 1 min lock
         * 15-19 attempts: 5 min lock
         * 20+ attempts: 10 min lock
         */
        
        let lockDuration = 0;
        
        if (count >= 20) {
            lockDuration = 10 * 60; // 20+ failures: Always 10 min
        } else if (count === 15) {
            lockDuration = 5 * 60;  // 15th failure: 5 min
        } else if (count === 10) {
            lockDuration = 1 * 60;  // 10th failure: 1 min
        } else if (count === 5) {
            lockDuration = 30;      // 5th failure: 30 sec
        }

        if (lockDuration > 0) {
            const lockKey = getLockKey(hospitalId, identifier, userId);
            await redisService.setex(lockKey, lockDuration, "locked");
            
            console.warn(
                `[LOGIN LOCK] Applied ${lockDuration}s lock to: ${hospitalId}:${normalizedId} at attempt #${count}.`
            );

            return { locked: true, lockDuration, attempts: count };
        }

        // 1-4 attempts -> No lock, just return current count
        return { locked: false, lockDuration: 0, attempts: count };
    } catch (err) {
        console.error("[LoginSecurity] Redis error on recording attempt:", err);
        return { locked: false, lockDuration: 0, attempts: 0 };
    }
};

/**
 * Clear failed login attempts on successful login.
 */
export const clearFailedAttempts = async (identifier: string, hospitalId: string = "global", userId?: string): Promise<void> => {
    if (!identifier) return;

    const normalizedId = identifier.trim().toLowerCase();

    try {
        const attemptKey = getAttemptKey(hospitalId, normalizedId, userId);
        const lockKey = getLockKey(hospitalId, normalizedId, userId);
        
        await redisService.del(attemptKey);
        await redisService.del(lockKey);
        
        console.log(`[LOGIN SUCCESS] Reset failure counter for: ${hospitalId}:${normalizedId}`);
    } catch (err) {
        console.error("[LoginSecurity] Redis error on clearing attempts:", err);
    }
};

/**
 * Secondary IP-based rate limiter to prevent large scale brute-force.
 */
export const loginRateLimiter = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `auth:ip_login_rate:${ip}`;

    try {
        const count = await redisService.incr(key);

        if (count === 1) {
            await redisService.setex(key, 10 * 60, "1"); // 10 min window
        }

        if (count > 50) { // Limit to 50 attempts per IP per 10 mins
            return res.status(429).json({
                message: "Too many login attempts from this network.",
                retryAfterSeconds: 600,
            });
        }

        next();
    } catch (err) {
        // FIX: Fail-CLOSED in production — if Redis is down, block login attempts
        if (process.env.NODE_ENV === "production") {
            console.error("[LoginSecurity] FAIL-CLOSED: Blocking login — Redis unavailable in production.");
            return res.status(503).json({
                message: "Authentication temporarily unavailable. Please try again shortly.",
            });
        }
        // Development: allow through
        next();
    }
};

export default {
    checkAccountLock,
    recordFailedAttempt,
    clearFailedAttempts,
    loginRateLimiter,
};
