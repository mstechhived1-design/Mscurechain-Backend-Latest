import express from "express";
import {
  bookOnlineAppointment,
  getOnlineAvailability,
  getMyMobileAppointments,
  createMobileOrder,
  verifyMobilePayment,
  renderMobileCheckoutPage,
} from "../Controllers/onlineBookingController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";

const router = express.Router();

// ── PUBLIC (no auth) ──────────────────────────────────────────────────────────
// Renders the HTML checkout page inside the in-app WebView
// Must be public because WebView doesn't send JWT headers
router.get("/checkout", renderMobileCheckoutPage);

// ── PROTECTED (patient JWT required) ─────────────────────────────────────────
router.use(protect);
router.use(resolveTenant);

// Availability check — any authenticated user can view
router.get("/availability", getOnlineAvailability);

// Payment order creation — patient only
router.post("/create-order", authorizeRoles("patient"), createMobileOrder);

// Payment signature verification — patient only
router.post("/verify-payment", authorizeRoles("patient"), verifyMobilePayment);

// Final appointment booking (after payment verified) — patient only
router.post("/book", authorizeRoles("patient"), bookOnlineAppointment);

// Patient's own appointment history
router.get("/my-appointments", authorizeRoles("patient"), getMyMobileAppointments);

export default router;
