import express from "express";
import {
  createSupportRequest,
  getAllSupportRequests,
  getMySupportRequests,
  getSupportRequestById,
  addReply,
  updateSupportStatus,
} from "../Controllers/supportController.js";
import {
  handleSupportWebhook,
  webhookHealthCheck,
} from "../Controllers/webhookController.js";
import { protect, authorize } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import upload from "../../middleware/Upload/upload.js";

const router = express.Router();

// ==========================================
// 🔗 WEBHOOK ROUTES (Support System → MsCureChain)
// These are global call-backs (No tenant required)
// ==========================================
// Health check for webhook
router.get("/webhook/health", webhookHealthCheck);

// Receive status updates from Support System
router.post("/webhook/status-update", handleSupportWebhook);

// ==========================================
// 📋 SUPPORT TICKET PROTECTED STACK
// ==========================================
router.use(protect);
router.use(resolveTenant);

// Create ticket (with attachments)
router.post("/", upload.array("attachments", 3), createSupportRequest);

// Get all tickets (Super Admin & Admin)
router.get(
  "/",
  authorize("super-admin", "hospital-admin"),
  getAllSupportRequests,
);

// Get current user's tickets
router.get("/my-tickets", getMySupportRequests);

// Get single ticket
router.get("/:id", getSupportRequestById);

// Reply to ticket (with attachments)
router.post("/:id/reply", upload.array("attachments", 3), addReply);

// Update ticket status (Admin/Super Admin)
router.put(
  "/:id/status",
  authorize("super-admin", "hospital-admin"),
  updateSupportStatus,
);

export default router;
