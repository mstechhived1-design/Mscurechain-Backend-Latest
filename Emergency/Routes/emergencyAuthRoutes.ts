import express from "express";
import { body } from "express-validator";
import * as emergencyAuthController from "../Controllers/emergencyAuthController.js";
import { authenticateEmergencyPersonnel } from "../../middleware/emergencyAuth.js";

const router = express.Router();

// @route   POST /api/emergency/auth/login
// @desc    Login ambulance personnel
// @access  Public
router.post(
    "/login",
    [
        body("identifier").notEmpty().withMessage("Employee ID or Mobile required"),
        body("password").notEmpty().withMessage("Password required"),
    ],
    emergencyAuthController.login
);

// @route   POST /api/emergency/auth/refresh
// @desc    Refresh access token
// @access  Public
router.post("/refresh", emergencyAuthController.refresh);

// @route   POST /api/emergency/auth/logout
// @desc    Logout ambulance personnel
// @access  Public
router.post("/logout", emergencyAuthController.logout);

// @route   GET /api/emergency/auth/me
// @desc    Get current ambulance personnel
// @access  Private
router.get("/me", authenticateEmergencyPersonnel, emergencyAuthController.me);

export default router;
