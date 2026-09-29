import express from "express";
import {
  bookAppointment,
  checkAvailability,
  updateAppointmentStatus,
  getAppointments,
  getHospitalAppointmentStats,
  getAppointmentById,
  createRazorpayOrder,
  verifyRazorpayPayment,
  renderCheckoutPage,
  checkFollowUpEligibility
} from "../Controllers/bookingController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

// PUBLIC ROUTES (No token required)
router.get("/checkout-razorpay", renderCheckoutPage); 

router.use(protect);
router.use(resolveTenant);

router.get(
  "/check-follow-up",
  authorizeRoles("helpdesk", "hospital-admin", "masterhelpdesk"),
  checkFollowUpEligibility
);

// Patient & Public Booking Actions (Above requireTenant)
router.post("/book", authorizeRoles("patient"), bookAppointment);
router.get(
  "/availability",
  authorizeRoles("patient", "helpdesk", "hospital-admin", "masterhelpdesk"),
  checkAvailability,
);
router.post("/create-order", authorizeRoles("patient"), createRazorpayOrder);
router.post("/verify-payment", authorizeRoles("patient"), verifyRazorpayPayment);

// Explicit Tenant Required for staff/admin operations
router.use(requireTenant);
router.patch(
  "/:id/status",
  authorizeRoles(
    "doctor",
    "helpdesk",
    "patient",
    "hospital-admin",
    "nurse",
    "lab",
    "masterhelpdesk",
  ),
  updateAppointmentStatus,
);

router.get(
  "/my-appointments",
  authorizeRoles(
    "patient",
    "doctor",
    "helpdesk",
    "hospital-admin",
    "nurse",
    "lab",
    "pharma-owner",
    "masterhelpdesk",
  ),
  getAppointments,
);
router.get(
  "/hospital/stats",
  authorizeRoles("hospital-admin", "super-admin", "helpdesk", "masterhelpdesk"),
  getHospitalAppointmentStats,
);
router.get(
  "/hospital-stats",
  authorizeRoles("hospital-admin", "super-admin", "helpdesk", "masterhelpdesk"),
  getHospitalAppointmentStats,
);
router.get(
  "/:id",
  authorizeRoles(
    "patient",
    "doctor",
    "helpdesk",
    "hospital-admin",
    "nurse",
    "lab",
    "pharma-owner",
    "masterhelpdesk",
  ),
  getAppointmentById,
);

export default router;
