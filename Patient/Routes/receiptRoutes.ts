import express from "express";
import { getReceiptHtml, sendReceiptWhatsApp } from "../Controllers/receiptController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";

const router = express.Router();

// Render receipt with full payload directly from client
router.post("/render", (req, res, next) => {
  if (req.headers.authorization?.startsWith("Bearer ") || req.cookies?.accessToken) {
    return protect(req, res, next);
  }
  next();
}, getReceiptHtml);

// Allow fetching official document by ID (authenticated users get full context; unauthenticated allowed for print/preview)
router.get("/:type/:id", (req, res, next) => {
  if (req.headers.authorization?.startsWith("Bearer ") || req.cookies?.accessToken) {
    return protect(req, res, next);
  }
  next();
}, getReceiptHtml);

router.post("/:type/:id/whatsapp", protect, sendReceiptWhatsApp);

export default router;
