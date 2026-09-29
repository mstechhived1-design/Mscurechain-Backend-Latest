import express from "express";
import { registerSuperAdmin, loginSuperAdmin } from "../Controllers/superAdminAuthController.js";
import {
    checkAccountLock,
    loginRateLimiter,
} from "../../middleware/Auth/loginSecurity.js";
import {
    superAdminLoginValidator,
    superAdminRegisterValidator,
} from "../../utils/validators.js";

const router = express.Router();

/**
 * Super Admin Routes
 * Format: /api/super-admin/:secret/login
 * Format: /api/super-admin/:secret/register
 * 
 * The secret key is part of the URL path as requested.
 */

// Middleware to extract secret from URL and put it in body for validation/controller consistency
const extractSecret = (req: any, res: any, next: any) => {
    if (req.params.secret) {
        req.body.secretKey = req.params.secret;
    }
    next();
};

// ─── Primary routes (Secret in URL) ───────────────────────────────────────────
router.post(
    "/:secret/register",
    extractSecret,
    superAdminRegisterValidator,
    registerSuperAdmin
);

router.post(
    "/:secret/login",
    extractSecret,
    loginRateLimiter,
    superAdminLoginValidator,
    checkAccountLock,
    loginSuperAdmin
);

// ─── Fallback/Alternative (Secret in Body) ────────────────────────────────────
// valid for scenarios where URL length is restricted or for stricter logging policies
router.post(
    "/secure/register",
    superAdminRegisterValidator,
    registerSuperAdmin,
);

router.post(
    "/secure/login",
    loginRateLimiter,
    superAdminLoginValidator,
    checkAccountLock,
    loginSuperAdmin,
);

export default router;
