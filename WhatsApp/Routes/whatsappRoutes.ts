import { Router } from "express";
import {
  getStatus,
  requestPairingCode,
  refreshQR,
  logout,
  updateTemplates,
  updateDepartmentRouting,
  getDepartmentDetectedNumbers,
  sendMedia,
  sendMessage,
} from "../Controllers/whatsappController.js";
// Import authentication middleware based on mscurechain's implementation
// import { protect, authorize } from "../../middleware/auth.js";

const router = Router({ mergeParams: true });

// Assume these routes might be mounted at /api/hospital/:hospitalId/whatsapp

router.get("/status", getStatus);
router.post("/pair", requestPairingCode);
router.post("/refresh", refreshQR);
router.post("/logout", logout);
router.put("/templates", updateTemplates); // Admin only route typically
router.put("/routing", updateDepartmentRouting); // Dynamic department routing & validation
router.get("/department-numbers", getDepartmentDetectedNumbers); // Auto-detect numbers from profiles
router.post("/send-media", sendMedia); // Called by portals via useWhatsAppSender
router.post("/send-message", sendMessage); // Called for test messages

export default router;
