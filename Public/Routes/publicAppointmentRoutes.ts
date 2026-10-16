import express from "express";
import {
  getPublicHospitalConfig,
  getPublicDoctors,
  getPublicDoctorAvailability,
  sendPublicOtp,
  verifyPublicOtp,
  bookPublicAppointment,
  getPublicAppointmentPass,
  getPublicHospitalStats,
} from "../Controllers/publicAppointmentController.js";

const router = express.Router();

// 1. Hospital Config & Admin 7-10 day Booking Window
router.get("/config/:hospitalId", getPublicHospitalConfig);

// 2. Doctor List (scoped to hospital, unscoped for MT safety)
router.get("/doctors/:hospitalId", getPublicDoctors);

// 3. Doctor Availability (schedule & leave check)
router.get("/doctors/:doctorId/availability", getPublicDoctorAvailability);

// 4. Send WhatsApp 4-Digit OTP
router.post("/send-otp", sendPublicOtp);

// 5. Verify WhatsApp OTP (5-min expiry, max 3 attempts)
router.post("/verify-otp", verifyPublicOtp);

// 6. Complete Booking (Atomic Token, Phone+DOB Match, WhatsApp Pass, Socket Broadcast)
router.post("/book", bookPublicAppointment);

// 7. Responsive Digital Appointment Pass Data
router.get("/pass/:passId", getPublicAppointmentPass);

// 8. Live Hospital Stats (Patient Count & IVF Deliveries by Symptoms)
router.get("/stats/:hospitalId", getPublicHospitalStats);

export default router;
