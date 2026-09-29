import express from "express";
import { body } from "express-validator";
import { login, logout, uploadDocument } from "../Controllers/dischargeAuthController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import upload from "../../middleware/Upload/upload.js";

const router = express.Router();

const loginValidator = [
    body("logid").notEmpty().withMessage("Log ID is required"),
    body("password").notEmpty().withMessage("Password is required")
];

router.post("/login", loginValidator, login);
router.post("/logout", logout);
router.post("/upload-document", protect, authorizeRoles("nurse", "helpdesk", "hospital-admin"), upload.single("document"), uploadDocument);

export default router;
