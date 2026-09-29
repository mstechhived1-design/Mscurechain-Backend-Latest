import { Request, Response, NextFunction } from "express";
import Appointment from "../Models/Appointment.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import User from "../../Auth/Models/User.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Patient from "../../Patient/Models/Patient.js";
import {
  getMasterHelpdeskAppointments,
  getHelpdeskAppointments,
} from "./helpdeskAppointmentController.js";
// import HelpDesk from "../../Helpdesk/Models/HelpDesk.js";
import Leave from "../../Leave/Models/Leave.js";
import MasterDoctorLeave from "../../MasterHelpdesk/Models/MasterDoctorLeave.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import { createNotification } from "../../Notification/Controllers/notificationController.js";
import { generateSlots } from "../../utils/slotUtils.js";
import { AppointmentRequest } from "../types/index.js";
import { Server } from "socket.io";
// import Stripe from "stripe";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Razorpay from "razorpay";
import crypto from "crypto";
import Transaction from "../../Admin/Models/Transaction.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import { invalidateDoctorCache } from "../../utils/cacheInvalidation.js";
import {
  generateTransactionId,
  generateReceiptNumber,
} from "../../utils/idGenerator.js";
import MobileAppointment from "../Models/MobileAppointment.js";

dotenv.config();

// Custom Request Interface to include io
interface RequestWithIO extends AppointmentRequest {
  io?: Server;
}

export const startAppointmentCleanupTask = (io: Server) => {
  setInterval(async () => {
    try {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      const expiredAppointments = await (
        Appointment.find({
          status: "pending",
          createdAt: { $lt: twoMinutesAgo },
        }) as any
      )
        .unscoped()
        .populate({ path: "patient", options: { unscoped: true } });

      if (expiredAppointments.length > 0) {
        console.log(
          `Found ${expiredAppointments.length} expired pending appointments.`,
        );
      }

      for (const app of expiredAppointments) {
        await (Appointment.findByIdAndDelete(app._id) as any).unscoped();

        if (app.patient) {
          const message = "Doctor is not available";
          const patientId = (app.patient as any)._id; // Cast because populate might return user doc

          await createNotification({ user: { _id: "SYSTEM" } } as any, {
            hospital: app.hospital,
            recipient: patientId,
            sender: app.doctor as any,
            type: "appointment_cancelled",
            message: message,
            relatedId: app._id as any,
          });

          io.to(`patient_${patientId}`).emit("appointment_cancelled", {
            appointmentId: app._id,
            message: message,
          });
        }
      }
    } catch (err) {
      console.error("Error in appointment cleanup task:", err);
    }
  }, 60 * 1000);
};

// ─── RAZORPAY INTEGRATION ───────────────────────────────────────────────────

export const createRazorpayOrder = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      amount,
      currency = "INR",
      receipt = `rcpt_${Date.now()}`,
    } = req.body;

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({
        message: "Razorpay keys are not configured in the environment.",
      });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    try {
      const order = await razorpay.orders.create({
        amount: Math.round(amount * 100), // convert to paise
        currency,
        receipt,
      });

      // Generate the Hosted Checkout URL for the frontend WebView
      const checkoutUrl = `${req.protocol}://${req.get("host")}/api/bookings/checkout-razorpay?amount=${order.amount}&orderId=${order.id}`;

      console.log(`[Razorpay] Order Created: ${order.id} for ₹${amount}`);
      res.status(200).json({
        ...order,
        checkoutUrl,
      });
    } catch (error: any) {
      console.error("[Razorpay] Order Creation Failed:", error);
      res.status(500).json({
        message: "Failed to create Razorpay order",
        error: error.message,
      });
    }
  },
);

export const verifyRazorpayPayment = asyncHandler(
  async (req: Request, res: Response) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment details" });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      console.log(`[Razorpay] Payment Verified: ${razorpay_payment_id}`);
      res.status(200).json({ status: "ok", message: "Payment verified" });
    } else {
      console.error("[Razorpay] Signature Verification Failed");
      res.status(400).json({ status: "error", message: "Invalid signature" });
    }
  },
);

/**
 * Renders a full HTML checkout page for Razorpay.
 * This is useful for Expo Go where native Razorpay SDK might be hard to bundle.
 */
export const renderCheckoutPage = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      amount,
      orderId,
      name,
      email,
      contact,
      hospitalName,
      hospitalLogo,
      themeColor = "#2C66EE",
      callbackUrl = "mscurechain-patient://payment-success",
    } = req.query;

    if (!amount || !orderId) {
      return res.status(400).send("Amount and Order ID are required.");
    }

    const razorpayKey = process.env.RAZORPAY_KEY_ID;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Razorpay Checkout</title>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f4f7fe; }
        .loader { border: 4px solid #f3f3f3; border-top: 4px solid ${themeColor}; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .container { text-align: center; }
        h2 { color: #333; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="loader"></div>
        <h2>Opening Payment Gateway...</h2>
    </div>

    <script>
        const options = {
            "key": "${razorpayKey}",
            "amount": "${amount}",
            "currency": "INR",
            "name": "${hospitalName || "MSCureChain"}",
            "description": "Consultation Fee",
            "image": "${hospitalLogo || ""}",
            "order_id": "${orderId}",
            "handler": function (response){
                const successUrl = "${callbackUrl}?razorpay_payment_id=" + response.razorpay_payment_id + 
                                   "&razorpay_order_id=" + response.razorpay_order_id + 
                                   "&razorpay_signature=" + response.razorpay_signature +
                                   "&status=success";
                window.location.href = successUrl;
            },
            "prefill": {
                "name": "${name || ""}",
                "email": "${email || ""}",
                "contact": "${contact || ""}"
            },
            "theme": {
                "color": "${themeColor}"
            },
            "modal": {
                "ondismiss": function(){
                    window.location.href = "${callbackUrl}?status=cancelled";
                }
            }
        };
        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function (response){
            window.location.href = "${callbackUrl}?status=error&code=" + response.error.code;
        });
        window.onload = function() {
            rzp.open();
        };
    </script>
</body>
</html>
    `;

    res.send(html);
  },
);

// ─── Follow-up Status Computation Helper ────────────────────────────────────
// Extracted so that BOTH bookAppointment() and checkFollowUpEligibility() share
// the exact same business logic without any duplication.
//
// Returns the follow-up status object that can be stored on the Appointment document
// and returned by the eligibility API. Does NOT touch HTTP req/res.
async function computeFollowUpStatus(
  hospitalId: string,
  patientId: string,
  doctorId: string | undefined,
  appointmentDate: Date,
  appointmentType: string,
): Promise<{
  eligible: boolean;
  visitCount: number;
  doctorVisitCount: number;
  rangeDays: number;
  expiryDate: Date;
  enableExpiry: boolean;
  message: string;
  calculatedAt: Date;
  // extra diagnostic fields (used by eligibility API response)
  diffDays?: number;
  remainingDays?: number;
  lastAppointmentDate?: Date | null;
  lastAppointmentDoctor?: string;
  visitCalculations?: string;
}> {
  // ── 1. Load hospital follow-up config ──────────────────────────────────────
  const hospital = await Hospital.findById(hospitalId)
    .select("name opdFollowUpDays ipdFollowUpDays enableFollowUpExpiry")
    .lean();

  if (!hospital) {
    throw new Error(`Hospital not found: ${hospitalId}`);
  }

  const enableExpiry: boolean = hospital.enableFollowUpExpiry ?? true;
  const opdRange: number = hospital.opdFollowUpDays ?? 7;
  const ipdRange: number = hospital.ipdFollowUpDays ?? 7;
  // rangeDays will be determined by the type of the PREVIOUS appointment
  let rangeDays: number = opdRange; // Default fallback

  // ── 2. Helpers ─────────────────────────────────────────────────────────────
  const formatDateDDMMYYYY = (dateInput: Date | string): string => {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "N/A";
    const day   = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year  = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const getOrdinalVisitString = (count: number): string => {
    const ordinals = ["First","Second","Third","Fourth","Fifth","Sixth","Seventh","Eighth","Ninth","Tenth"];
    return count >= 1 && count <= ordinals.length ? `${ordinals[count - 1]} Visit` : `Visit #${count}`;
  };

  // ── 3. Resolve all possible patient IDs ────────────────────────────────────
  const ACTUAL_CONSULTATION_STATUSES  = ["completed", "confirmed", "booked", "scheduled", "arrived", "in-progress", "admitted"];

  let patientIds: string[] = [String(patientId)];
  try {
    const patDoc  = await (Patient.findById(patientId)          as any).unscoped().lean().catch(() => null);
    if (patDoc?.user)    patientIds.push(String(patDoc.user));
    if (patDoc?._id)     patientIds.push(String(patDoc._id));

    const profDoc = await (PatientProfile.findById(patientId)   as any).unscoped().lean().catch(() => null);
    if (profDoc?.user)   patientIds.push(String(profDoc.user));
    if (profDoc?.patient)patientIds.push(String(profDoc.patient));

    const byUser  = await (Patient.findOne({ user: patientId }) as any).unscoped().lean().catch(() => null);
    if (byUser?._id)     patientIds.push(String(byUser._id));
    if (byUser?.user)    patientIds.push(String(byUser.user));
  } catch (_e) {
    // fall back to raw patientId if resolution fails
  }
  patientIds = [...new Set(patientIds)];

  const patientMatchCondition = {
    $or: patientIds.flatMap(pid => [
      { patient: pid },
      { globalPatientId: pid },
    ]),
  };

  // ── 4. Count visits ────────────────────────────────────────────────────────
  const overallOpdCount = await (Appointment.countDocuments({
    ...patientMatchCondition,
    hospital: hospitalId,
    status: { $in: ACTUAL_CONSULTATION_STATUSES }
  }) as any).unscoped();

  const overallIpdCount = await (IPDAdmission.countDocuments({
    ...patientMatchCondition,
    hospital: hospitalId,
    status: { $in: ["Active", "Discharged", "Discharge Initiated"] }
  }) as any).unscoped();

  const overallPaidCount = overallOpdCount + overallIpdCount;

  let doctorPaidCount = 0;
  if (doctorId) {
    const doctorOpdCount = await (Appointment.countDocuments({
      ...patientMatchCondition,
      hospital:  hospitalId,
      doctor:    doctorId,
      status:    { $in: ACTUAL_CONSULTATION_STATUSES }
    }) as any).unscoped();

    const doctorIpdCount = await (IPDAdmission.countDocuments({
      ...patientMatchCondition,
      hospital:  hospitalId,
      primaryDoctor: doctorId,
      status: { $in: ["Active", "Discharged", "Discharge Initiated"] }
    }) as any).unscoped();

    doctorPaidCount = doctorOpdCount + doctorIpdCount;
  }

  const overallVisitCount = overallPaidCount + 1;
  const doctorVisitCount  = doctorId ? (doctorPaidCount + 1) : overallVisitCount;
  const visitCalculations = getOrdinalVisitString(doctorVisitCount);

  // ── 5. Find last paid consultation ─────────────────────────────────────────
  let lastPaid: any = null;
  if (doctorId) {
    const lastOpd = await (Appointment.findOne({
      $and: [
        patientMatchCondition,
        {
          hospital: hospitalId,
          doctor:   doctorId,
          status:   { $in: ACTUAL_CONSULTATION_STATUSES },
          type: { $nin: ["follow-up", "Follow-up", "FOLLOW-UP"] }
        },
      ],
    }) as any)
      .unscoped()
      .sort({ date: -1 })
      .populate({ path: "doctor", populate: { path: "user", select: "name" } })
      .lean();

    const lastIpdAd = await (IPDAdmission.findOne({
      $and: [
        patientMatchCondition,
        {
          hospital: hospitalId,
          primaryDoctor: doctorId,
          status: { $in: ["Active", "Discharged", "Discharge Initiated"] }
        }
      ]
    }) as any)
      .unscoped()
      .sort({ admissionDate: -1 })
      .populate({ path: "primaryDoctor", populate: { path: "user", select: "name" } })
      .lean();

    if (lastOpd && lastIpdAd) {
      lastPaid = lastOpd.date > lastIpdAd.admissionDate 
        ? { ...lastOpd, appType: "OPD" } 
        : { ...lastIpdAd, date: lastIpdAd.admissionDate, doctor: lastIpdAd.primaryDoctor, appType: "IPD" };
    } else if (lastOpd) {
      lastPaid = { ...lastOpd, appType: "OPD" };
    } else if (lastIpdAd) {
      lastPaid = { ...lastIpdAd, date: lastIpdAd.admissionDate, doctor: lastIpdAd.primaryDoctor, appType: "IPD" };
    }
  }

  const lastOpdOverall: any = await (Appointment.findOne({
    $and: [
      patientMatchCondition,
      {
        hospital: hospitalId,
        status:   { $in: ACTUAL_CONSULTATION_STATUSES },
        type: { $nin: ["follow-up", "Follow-up", "FOLLOW-UP"] }
      },
    ],
  }) as any)
    .unscoped()
    .sort({ date: -1 })
    .populate({ path: "doctor", populate: { path: "user", select: "name" } })
    .lean();

  const lastIpdOverallAd: any = await (IPDAdmission.findOne({
    $and: [
      patientMatchCondition,
      {
        hospital: hospitalId,
        status: { $in: ["Active", "Discharged", "Discharge Initiated"] }
      }
    ]
  }) as any)
    .unscoped()
    .sort({ admissionDate: -1 })
    .populate({ path: "primaryDoctor", populate: { path: "user", select: "name" } })
    .lean();

  let lastPaidOverall: any = null;
  if (lastOpdOverall && lastIpdOverallAd) {
    lastPaidOverall = lastOpdOverall.date > lastIpdOverallAd.admissionDate
      ? { ...lastOpdOverall, appType: "OPD" }
      : { ...lastIpdOverallAd, date: lastIpdOverallAd.admissionDate, doctor: lastIpdOverallAd.primaryDoctor, appType: "IPD" };
  } else if (lastOpdOverall) {
    lastPaidOverall = { ...lastOpdOverall, appType: "OPD" };
  } else if (lastIpdOverallAd) {
    lastPaidOverall = { ...lastIpdOverallAd, date: lastIpdOverallAd.admissionDate, doctor: lastIpdOverallAd.primaryDoctor, appType: "IPD" };
  }

  const compareDate = new Date(appointmentDate);

  // ── 6. First-visit path ────────────────────────────────────────────────────
  if (!lastPaidOverall) {
    const expiryDate = new Date(compareDate);
    expiryDate.setDate(expiryDate.getDate() + rangeDays);
    return {
      eligible: false,
      enableExpiry,
      rangeDays,
      visitCount: 1,
      doctorVisitCount: 1,
      visitCalculations: "First Visit",
      expiryDate,
      lastAppointmentDate: null,
      lastAppointmentDoctor: undefined,
      message: "First Visit - No previous consultation found.",
      calculatedAt: new Date(),
    };
  }

  if (doctorId && !lastPaid) {
    // Patient has visits at this hospital but NOT with this specific doctor
    const overallDocName  = lastPaidOverall.doctor?.user?.name || lastPaidOverall.doctorName || "another doctor";
    const overallDateStr  = formatDateDDMMYYYY(lastPaidOverall.date);
    const overallBillDate = formatDateDDMMYYYY(lastPaidOverall.payment?.date || lastPaidOverall.date);
    const expiryDate      = new Date(lastPaidOverall.date);
    expiryDate.setDate(expiryDate.getDate() + rangeDays);
    const overallAppTypeStr = lastPaidOverall.appType === "IPD" ? "IPD admission" : "OPD consultation";
    return {
      eligible: false,
      enableExpiry,
      rangeDays,
      visitCount: overallVisitCount,
      doctorVisitCount,
      visitCalculations,
      expiryDate,
      lastAppointmentDate:   lastPaidOverall.date,
      lastAppointmentDoctor: overallDocName,
      message: `Patient had an ${overallAppTypeStr} on ${overallDateStr} (Bill Date: ${overallBillDate}) with ${overallDocName}. First visit to this doctor.`,
      calculatedAt: new Date(),
    };
  }

  // ── 7. Returning-patient path ───────────────────────────────────────────────
  const targetLastPaid  = lastPaid || lastPaidOverall;
  rangeDays = targetLastPaid.appType === "IPD" ? ipdRange : opdRange;

  const lastDate        = new Date(targetLastPaid.date);
  const diffTime        = Math.abs(compareDate.getTime() - lastDate.getTime());
  const diffDays        = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const eligible        = !enableExpiry || (diffDays <= rangeDays);
  const expiryDate      = new Date(lastDate);
  expiryDate.setDate(expiryDate.getDate() + rangeDays);

  const targetDocName   = targetLastPaid.doctor?.user?.name || targetLastPaid.doctorName || "the doctor";
  const lastDateStr     = formatDateDDMMYYYY(lastDate);
  const billDateStr     = formatDateDDMMYYYY(targetLastPaid.payment?.date || lastDate);
  const expiryDateStr   = formatDateDDMMYYYY(expiryDate);

  const targetAppTypeStr = targetLastPaid.appType === "IPD" ? "IPD admission" : "OPD consultation";

  const message = eligible
    ? `Patient had an ${targetAppTypeStr} on ${lastDateStr} (Bill: ${billDateStr}) with ${targetDocName}. Appointment on ${formatDateDDMMYYYY(compareDate)} is within the follow-up window (expires ${expiryDateStr}). ${visitCalculations}.`
    : `Patient had an ${targetAppTypeStr} on ${lastDateStr} (Bill: ${billDateStr}) with ${targetDocName}. Appointment on ${formatDateDDMMYYYY(compareDate)} is outside the follow-up window (expired ${expiryDateStr}). New consultation — ${visitCalculations}.`;

  return {
    eligible,
    enableExpiry,
    rangeDays,
    visitCount:            overallVisitCount,
    doctorVisitCount,
    visitCalculations,
    expiryDate,
    lastAppointmentDate:   targetLastPaid.date,
    lastAppointmentDoctor: targetDocName,
    diffDays,
    remainingDays: Math.max(0, rangeDays - diffDays),
    message,
    calculatedAt:  new Date(),
  };
}

export const bookAppointment = asyncHandler(
  async (req: Request, res: Response) => {
    const bookingReq = req as unknown as RequestWithIO;
    console.log("[DEBUG] bookAppointment incoming body:", bookingReq.body);
    console.time("bookAppointmentDuration");
    try {
      const {
        doctorId,
        date,
        time,
        timeSlot,
        startTime: bodyStartTime,
        endTime: bodyEndTime,
        symptoms,
        reason,
        urgency,
        vitals,
        appointmentType: reqAppType,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
      } = bookingReq.body;

      // Decide patientId: if helpdesk/admin, take from body, else use logged in user's ID
      let patientId = bookingReq.user!._id;
      if (
        ["helpdesk", "hospital-admin", "super-admin"].includes(
          bookingReq.user!.role,
        ) &&
        bookingReq.body.patientId
      ) {
        patientId = bookingReq.body.patientId;
      }

      // CRITICAL FIX: Ensure patientId is the USER ID, not the PatientProfile ID.
      // If it's a PatientProfile ID, we need to find the User ID.
      const potentialProfile = await PatientProfile.findById(patientId);
      if (potentialProfile && potentialProfile.user) {
        console.log(
          `[Booking] Resolved PatientProfile ID ${patientId} to User ID ${potentialProfile.user}`,
        );
        patientId = potentialProfile.user as any;
      }

      let resolvedDoctor =
        await DoctorProfile.findById(doctorId).populate("user");
      let finalDoctorId = doctorId;

      if (!resolvedDoctor) {
        resolvedDoctor = await DoctorProfile.findOne({
          user: doctorId,
        }).populate("user");
        if (resolvedDoctor) {
          finalDoctorId = resolvedDoctor._id as any;
        } else {
          return res.status(404).json({ message: "Doctor not found" });
        }
      }
      const doctor = resolvedDoctor;

      // Patients shouldn't book with themselves (if they are also doctors), but helpdesk can book for any patient.
      const doctorUser = doctor.user as any;
      if (
        bookingReq.user!._id.toString() ===
        (doctorUser?._id || doctorUser)?.toString()
      ) {
        return res
          .status(400)
          .json({ message: "You cannot book an appointment with yourself." });
      }

      const targetHospitalId = (bookingReq as any).user?.hospital;
      if (!targetHospitalId)
        return res
          .status(400)
          .json({ message: "Hospital association not found in session" });

      const hospital = await Hospital.findById(targetHospitalId);
      if (!hospital)
        return res
          .status(404)
          .json({ message: "Clinic/Hospital settings not found" });

      // Support fallback to 'time' field
      let reqStart = bodyStartTime || time;
      let reqEnd = bodyEndTime || time;

      if (timeSlot && timeSlot.includes(" - ")) {
        const parts = timeSlot.split(" - ");
        reqStart = parts[0];
        reqEnd = parts[1];
      }

      if (!reqStart || !reqEnd) {
        // If no time is provided, we still allow booking in queue-based system
        reqStart = new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        reqEnd = reqStart;
      }

      const dayName = new Date(date).toLocaleDateString("en-US", {
        weekday: "long",
      });

      let availability: any = doctor.availability?.find(
        (a: any) => a.days && a.days.includes(dayName),
      );
      let startTimeVal, endTimeVal, breakStartVal, breakEndVal;

      if (availability) {
        startTimeVal = availability.startTime;
        endTimeVal = availability.endTime;
        breakStartVal = availability.breakStart;
        breakEndVal = availability.breakEnd;
      } else {
        // If no availability set or doctor not available on this day,
        // use default hours (9 AM - 6 PM) for walk-in bookings
        startTimeVal = "09:00 AM";
        endTimeVal = "06:00 PM";
        breakStartVal = null;
        breakEndVal = null;
      }

      // 🔐 LEAVE CHECK: Block bookings if doctor is on leave
      const bookingDate = new Date(date);
      const dayStart = new Date(bookingDate.setHours(0, 0, 0, 0));
      const dayEnd = new Date(bookingDate.setHours(23, 59, 59, 999));

      const [onOldLeave, onMasterLeave] = await Promise.all([
        Leave.findOne({
          requester: (doctor.user as any)._id,
          status: "approved",
          startDate: { $lte: dayEnd },
          endDate: { $gte: dayStart },
        }),
        MasterDoctorLeave.findOne({
          doctor: (doctor.user as any)._id,
          status: "approved",
          startDate: { $lte: dayEnd },
          endDate: { $gte: dayStart },
        }),
      ]);

      if (onOldLeave || onMasterLeave) {
        return res
          .status(400)
          .json({ message: `Doctor is on leave on ${dayName}` });
      }

      // CHECK FOR EXISTING ACTIVE APPOINTMENT WITH SAME DOCTOR ON SAME DAY
      const startOfDayCheck = new Date(date);
      startOfDayCheck.setHours(0, 0, 0, 0);
      const endOfDayCheck = new Date(date);
      endOfDayCheck.setHours(23, 59, 59, 999);

      // CHECK FOR DOCTOR LEAVE
      const isLeave = await (
        Leave.findOne({
          requester: doctorUser?._id || doctorUser,
          status: "approved",
          $or: [
            {
              startDate: { $lte: endOfDayCheck },
              endDate: { $gte: startOfDayCheck },
            },
          ],
        }) as any
      ).unscoped();
      const isMasterLeave = await MasterDoctorLeave.findOne({
        doctor: doctorUser?._id || doctorUser,
        status: "approved",
        $or: [
          {
            startDate: { $lte: endOfDayCheck },
            endDate: { $gte: startOfDayCheck },
          },
        ],
      });

      if (isLeave || isMasterLeave) {
        return res
          .status(400)
          .json({
            message:
              "Doctor is on approved leave on this date. Appointments cannot be booked.",
          });
      }

      console.log(
        `[DUPLICATE CHECK] Scoping duplicate check for Patient: ${patientId}, Doctor: ${finalDoctorId}, Date: ${date}`,
      );

      const existingActiveBooking = await (
        Appointment.findOne({
          patient: patientId,
          doctor: finalDoctorId,
          date: {
            $gte: startOfDayCheck,
            $lte: endOfDayCheck,
          },
          status: {
            $in: ["pending", "confirmed", "in-progress", "waiting", "Booked"],
            $nin: ["cancelled", "rejected", "completed"],
          },
        }) as any
      ).unscoped();

      if (existingActiveBooking) {
        console.warn(
          `[DUPLICATE ALERT] Conflict detected for Patient ${patientId} with Doctor ${finalDoctorId} on ${date}. Appointment ID: ${existingActiveBooking._id}. Proceeding anyway as requested by Helpdesk.`,
        );
        // Note: We are now allowing this to proceed for Helpdesk to avoid the "Always Blocked" issue reported.
        // If strict blocking is needed, this should be reverted to return res.status(400).
      }

      const validSlots = generateSlots(
        startTimeVal,
        endTimeVal,
        breakStartVal,
        breakEndVal,
      );

      let finalStartTime = reqStart;
      let finalEndTime = reqEnd;

      try {
        if (reqStart) {
          const dStart = new Date(`2000-01-01 ${reqStart}`);
          if (!isNaN(dStart.getTime())) {
            finalStartTime = dStart.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
          }
        }
        if (reqEnd) {
          const dEnd = new Date(`2000-01-01 ${reqEnd}`);
          if (!isNaN(dEnd.getTime())) {
            finalEndTime = dEnd.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
          }
        }
      } catch (e) {
        console.error("Time normalization error:", e);
      }

      // Try to find exact match in generated 5-min slots
      const exactMatch = validSlots.find(
        (s) => s.startTime === reqStart && s.endTime === reqEnd,
      );

      if (!exactMatch) {
        // WALK-IN BOOKING: Accept any time without validation
        // No need to check if slot exists in generated slots
        // Just use the provided time or current time
        finalStartTime = reqStart;
        finalEndTime = reqEnd;

        // REMOVED: Time slot validation for walk-in bookings
        // The helpdesk should be able to book at any time
      } else if (!exactMatch && reqStart && reqEnd) {
        // If manual time provided but doesn't match 5-min slots, we still allow it
        finalStartTime = reqStart;
        finalEndTime = reqEnd;
      }

      // 🔐 CONCURRENCY CHECK: Ensure the exact time slot isn't already taken by another patient
      const existing = await (
        Appointment.findOne({
          doctor: finalDoctorId,
          hospital: targetHospitalId,
          date: new Date(date),
          startTime: finalStartTime,
          status: { $nin: ["cancelled", "rejected"] },
        }) as any
      ).unscoped();

      if (existing) {
        const isSamePatient = existing.patient?.toString() === patientId?.toString();
        const isFrontDesk = ["helpdesk", "masterhelpdesk", "hospital-admin", "super-admin"].includes(bookingReq.user!.role);

        if (isSamePatient) {
          return res.status(400).json({
            message: "An appointment already exists for this patient at this exact time.",
          });
        } else if (!isFrontDesk) {
          return res.status(400).json({
            message: "This exact time slot was just booked by another patient. Please select a different time.",
          });
        }
      }

      const startTime = finalStartTime;
      const endTime = finalEndTime;

      const patientProfile = await PatientProfile.findOne({ user: patientId });
      let mrn: string | null = null;

      // Capture extra details if passed in body (e.g. from helpdesk booking)
      const {
        honorific,
        appointmentHonorific,
        guardianName,
        guardianRelation,
        relationship,
        guardianMobile,
        doctorReference,
        address,
        emergencyContact,
        bloodGroup,
        maritalStatus,
        medicalHistory,
        allergies,
      } = bookingReq.body;

      if (patientProfile) {
        if (patientProfile.mrn) {
          mrn = patientProfile.mrn;
          patientProfile.lastVisit = new Date();
        } else {
          const initials = hospital.name
            .split(" ")
            .map((n: string) => n[0])
            .join("")
            .toUpperCase();
          const randomNum = Math.floor(100 + Math.random() * 900);
          const year = new Date().getFullYear();
          mrn = `${initials}${randomNum}${year}`;
          patientProfile.hospital = targetHospitalId;
          patientProfile.mrn = mrn;
          patientProfile.lastVisit = new Date();
        }

        // Update profile with missing details if provided (without gender derivation)
        if (honorific) {
          patientProfile.honorific = honorific;
        }

        if (address) patientProfile.address = address;
        if (emergencyContact) patientProfile.alternateNumber = emergencyContact;
        if (bloodGroup) patientProfile.bloodGroup = bloodGroup;
        if (maritalStatus) patientProfile.maritalStatus = maritalStatus;

        // Append history/allergies if new ones are added (check for duplicates)
        if (medicalHistory && medicalHistory !== "None") {
          const currentHistory = patientProfile.medicalHistory || "";
          if (!currentHistory.includes(medicalHistory)) {
            patientProfile.medicalHistory =
              currentHistory && currentHistory !== "None"
                ? `${currentHistory}, ${medicalHistory}`
                : medicalHistory;
          }
        }
        if (allergies && allergies !== "None") {
          const currentAllergies = patientProfile.allergies
            ? Array.isArray(patientProfile.allergies)
              ? patientProfile.allergies.join(", ")
              : patientProfile.allergies
            : "";

          // If it's an array field in schema but treated as string here, handle carefully.
          // Assuming it might be a string based on usage.
          // If the incoming allergy is not part of the current string, append it.
          if (!currentAllergies.includes(allergies)) {
            patientProfile.allergies =
              currentAllergies && currentAllergies !== "None"
                ? `${currentAllergies}, ${allergies}`
                : allergies;
          }
        }

        await patientProfile.save();
      }

      const consultationFee =
        bookingReq.body.amount !== undefined
          ? bookingReq.body.amount
          : doctor.consultationFee || 0;
      let finalPaymentStatus = bookingReq.body.paymentStatus || "Paid";
      let finalPaymentMethod = bookingReq.body.paymentMethod || "cash";
      let finalAmount = consultationFee;

      // Check if this is an IPD appointment and sync payment from existing admission
      const appointmentType =
        bookingReq.body.type || reqAppType || "Consultation";
      if (appointmentType.toUpperCase() === "IPD") {
        // Look for existing IPD admission for this patient
        const existingAdmission = await IPDAdmission.findOne({
          patient: patientId,
          hospital: targetHospitalId,
          status: "Active",
        }).sort({ createdAt: -1 });

        if (existingAdmission) {
          // Use payment details from the IPD admission
          finalAmount = existingAdmission.amount || 0;
          finalPaymentMethod = existingAdmission.paymentMethod || "cash";
          finalPaymentStatus = existingAdmission.paymentStatus || "pending";
          console.log(
            `[Book Appointment] Found IPD admission ${existingAdmission.admissionId}, syncing payment: ₹${finalAmount}`,
          );
        } else {
          console.log(
            `[Book Appointment] No existing IPD admission found for patient ${patientId}`,
          );
        }
      }

      // Handle Vitals: use provided or fallback to profile
      // Map frontend keys (bp, spo2) to backend Schema keys (bloodPressure, spO2)
      const incomingVitals = vitals || {};
      const finalVitals = {
        bloodPressure:
          incomingVitals.bp ||
          incomingVitals.bloodPressure ||
          patientProfile?.bloodPressure,
        temperature:
          incomingVitals.temp ||
          incomingVitals.temperature ||
          patientProfile?.temperature,
        pulse: incomingVitals.pulse || patientProfile?.pulse,
        spO2:
          incomingVitals.spo2 || incomingVitals.spO2 || patientProfile?.spO2,
        height: incomingVitals.height || patientProfile?.height,
        weight: incomingVitals.weight || patientProfile?.weight,
        glucose:
          incomingVitals.glucose ||
          incomingVitals.sugar ||
          patientProfile?.glucose ||
          patientProfile?.sugar,
      };

      // Handle Notes/Symptoms mapping
      // Frontend sends 'notes', Schema expects 'reason' or 'symptoms'
      const finalReason = reason || bookingReq.body.notes;
      const finalSymptoms = symptoms || (finalReason ? [finalReason] : []);

      let paymentStatus = "not_required";
      let stripeSessionId = null;
      let paymentUrl = null;

      const appTypePrefix =
        appointmentType.toUpperCase() === "IPD"
          ? "IPD"
          : appointmentType.toUpperCase() === "OPD" ||
              appointmentType === "offline"
            ? "OPD"
            : "APT";
      const transactionId = await generateTransactionId(
        targetHospitalId,
        hospital.name,
        appTypePrefix as any,
      );
      const receiptNumber =
        finalPaymentStatus === "Paid" || finalPaymentStatus === "paid"
          ? transactionId
          : undefined;

      // ── Compute & persist follow-up status at booking time ──────────────────
      // We capture the hospital's current follow-up settings (rangeDays, enableExpiry)
      // together with the calculated expiryDate into the appointment document.
      // This guarantees that printing a historical receipt later always shows the
      // correct expiry — even if the hospital admin changes the settings afterwards.
      let appointmentFollowUpStatus: Awaited<ReturnType<typeof computeFollowUpStatus>> | undefined;
      try {
        appointmentFollowUpStatus = await computeFollowUpStatus(
          String(targetHospitalId),
          String(patientId),
          String(finalDoctorId),
          new Date(date),
          appointmentType,
        );
        console.log(
          `[Booking] followUpStatus computed: eligible=${appointmentFollowUpStatus.eligible} ` +
          `rangeDays=${appointmentFollowUpStatus.rangeDays} expiryDate=${appointmentFollowUpStatus.expiryDate}`,
        );
      } catch (fsErr) {
        // Follow-up status computation is non-blocking — log and continue.
        // The appointment will be created without followUpStatus which is handled
        // gracefully in the receipt layer (no expiry info shown for such records).
        console.warn("[Booking] computeFollowUpStatus failed (non-fatal):", fsErr);
      }

      // ── Compute daily exact token number ─────────────────────────────────────
      const startOfDayToken = new Date(date);
      startOfDayToken.setHours(0, 0, 0, 0);
      const endOfDayToken = new Date(date);
      endOfDayToken.setHours(23, 59, 59, 999);

      const activeTodayCount = await Appointment.countDocuments({
         hospital: targetHospitalId,
         date: { $gte: startOfDayToken, $lte: endOfDayToken },
         status: { $nin: ["cancelled", "rejected", "no-show"] }
      });
      const generatedTokenNumber = String(activeTodayCount + 1).padStart(2, "0");

      const finalAppointmentHonorific = appointmentHonorific || honorific || patientProfile?.honorific;
      const finalGuardianName = guardianName || bookingReq.body.patientDetails?.guardianName || patientProfile?.GuardianName;
      const finalGuardianRelation = guardianRelation || relationship || bookingReq.body.patientDetails?.guardianRelation || patientProfile?.GuardianRelation;
      const finalGuardianMobile = guardianMobile || bookingReq.body.patientDetails?.guardianMobile || patientProfile?.GuardianMobile;
      const finalDoctorReference = doctorReference || bookingReq.body.patientDetails?.doctorReference || patientProfile?.doctorReference;

      const incomingDiscount = Number(bookingReq.body.discount ?? bookingReq.body.payment?.discount ?? 0);
      const incomingDiscountType = bookingReq.body.discountType || bookingReq.body.payment?.discountType || "flat";
      const incomingDiscountValue = Number(bookingReq.body.discountValue ?? bookingReq.body.payment?.discountValue ?? incomingDiscount);
      const incomingFee = Number(bookingReq.body.fee ?? bookingReq.body.totalBillAmount ?? bookingReq.body.originalAmount ?? bookingReq.body.payment?.fee ?? bookingReq.body.payment?.totalBillAmount ?? bookingReq.body.payment?.originalAmount ?? (finalAmount + incomingDiscount));

      const appointment = await Appointment.create({
        token_number: generatedTokenNumber,
        patient: patientId,
        globalPatientId: patientId,
        doctor: finalDoctorId,
        hospital: targetHospitalId,
        date: new Date(date),
        appointmentTime: startTime, // Set appointmentTime for compatibility
        appointmentId: transactionId, // Use new unique ID format
        startTime,
        endTime,
        symptoms: finalSymptoms,
        reason: finalReason,
        type: appointmentType,
        visitType: bookingReq.body.visitType,
        urgency: urgency || "non-urgent",
        mrn,
        status:
          appointmentType.toUpperCase() === "IPD" ? "confirmed" : "Booked",
        appointmentHonorific: finalAppointmentHonorific,
        honorific: finalAppointmentHonorific,
        guardianName: finalGuardianName,
        guardianRelation: finalGuardianRelation,
        guardianMobile: finalGuardianMobile,
        doctorReference: finalDoctorReference,
        patientDetails: {
          ...bookingReq.body.patientDetails,
          honorific: finalAppointmentHonorific,
          guardianName: finalGuardianName,
          guardianRelation: finalGuardianRelation,
          guardianMobile: finalGuardianMobile,
          doctorReference: finalDoctorReference,
        },
        paymentStatus: finalPaymentStatus,
        paymentMethod: finalPaymentMethod,
        amount: finalAmount,
        fee: incomingFee,
        totalBillAmount: incomingFee,
        originalAmount: incomingFee,
        discount: incomingDiscount,
        discountType: incomingDiscountType,
        discountValue: incomingDiscountValue,
        payment: {
          amount: finalAmount,
          fee: incomingFee,
          totalBillAmount: incomingFee,
          originalAmount: incomingFee,
          discount: incomingDiscount,
          discountType: incomingDiscountType,
          discountValue: incomingDiscountValue,
          paymentMethod: finalPaymentMethod,
          paymentStatus: finalPaymentStatus,
          receiptNumber: receiptNumber, // Store generated receipt number
          razorpayOrderId: razorpayOrderId || null,
          razorpayPaymentId: razorpayPaymentId || null,
          razorpaySignature: razorpaySignature || null,
          paymentDetails: bookingReq.body.payment?.paymentDetails || (finalPaymentMethod === 'mixed' ? bookingReq.body.mixedPayments : undefined),
        },
        vitals: finalVitals,
        // Persist the computed follow-up status snapshot.
        // undefined is fine if computation failed — Mongoose will simply omit the field.
        followUpStatus: appointmentFollowUpStatus
          ? {
              eligible:         appointmentFollowUpStatus.eligible,
              visitCount:       appointmentFollowUpStatus.visitCount,
              doctorVisitCount: appointmentFollowUpStatus.doctorVisitCount,
              rangeDays:        appointmentFollowUpStatus.rangeDays,
              expiryDate:       appointmentFollowUpStatus.expiryDate,
              enableExpiry:     appointmentFollowUpStatus.enableExpiry,
              message:          appointmentFollowUpStatus.message,
              calculatedAt:     appointmentFollowUpStatus.calculatedAt,
            }
          : undefined,
      });

      // Synchronize latest valid Guardian Details with PatientProfile for this hospital
      const invalidGValues = ["", "N/A", "n/a", "NA", "na", "null", "undefined"];
      const gUpdateObj: any = {};
      if (finalGuardianName && !invalidGValues.includes(finalGuardianName)) gUpdateObj.GuardianName = finalGuardianName.trim();
      if (finalGuardianRelation && !invalidGValues.includes(finalGuardianRelation)) gUpdateObj.GuardianRelation = finalGuardianRelation.trim();
      if (finalGuardianMobile && !invalidGValues.includes(finalGuardianMobile)) gUpdateObj.GuardianMobile = finalGuardianMobile.trim();
      if (finalDoctorReference && !invalidGValues.includes(finalDoctorReference)) gUpdateObj.doctorReference = finalDoctorReference.trim();
      if (Object.keys(gUpdateObj).length > 0) {
        await PatientProfile.findOneAndUpdate(
          { user: patientId, hospital: targetHospitalId },
          { $set: gUpdateObj },
          { upsert: true }
        ).catch(() => {});
      }

      // Create Transaction for Booking
      if (finalAmount > 0 || incomingFee > 0) {
        await Transaction.create({
          user: patientId,
          userModel: "Patient", // Most appointment bookings are for patients
          hospital: targetHospitalId,
          subtotal: incomingFee,
          discountAmount: incomingDiscount,
          amount: finalAmount,
          paidAmount: (finalPaymentStatus === "Paid" || finalPaymentStatus === "paid") ? finalAmount : 0,
          type:
            appointmentType.toUpperCase() === "IPD"
              ? "ipd_advance"
              : "appointment_booking",
          status: (finalPaymentStatus === "Paid" || finalPaymentStatus === "paid") ? "completed" : "pending",
          referenceId: appointment._id,
          transactionId: transactionId,
          receiptNumber: receiptNumber,
          date: new Date(),
          paymentMode: (bookingReq.body.paymentMethod || "cash").toLowerCase(),
          paymentDetails: bookingReq.body.payment?.paymentDetails || (bookingReq.body.paymentMethod === "mixed" ? bookingReq.body.mixedPayments : {
            cash:
              bookingReq.body.paymentMethod === "cash" ? finalAmount : 0,
            upi: bookingReq.body.paymentMethod === "upi" ? finalAmount : 0,
            card:
              bookingReq.body.paymentMethod === "card" ? finalAmount : 0,
          }),
        });
      }

      // ── TRIGGER NOTIFICATIONS FOR CONFIRMED/PAID APPOINTMENTS ───────────────
      const isActuallyPaid =
        finalPaymentStatus === "Paid" ||
        finalPaymentStatus === "paid" ||
        finalPaymentStatus === "not_required";

      if (isActuallyPaid) {
        if (doctor.user) {
          const patient = await Patient.findById(patientId);
          const patientName = patient ? patient.name : "Patient";
          const doctorName = (doctor.user as any)?.name || "Doctor";
          const appType = appointmentType?.toUpperCase() || "OPD";
          const dateStr = new Date(date).toDateString();

          const formatStatus = (s: string) => {
            if (!s) return "";
            return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
          };
          const formattedStatus = formatStatus(appointment.status);
          const detailedMsg = `${appType} Appointment: Patient: ${patientName}, Doctor: ${doctorName}, Date: ${dateStr}, Time: ${startTime}, Status: ${formattedStatus}`;

          console.log(
            `[Booking] Sending notification for ${appointment._id} to Doctor ${(doctor.user as any)._id}`,
          );

          // Notify Doctor
          await createNotification(bookingReq as any, {
            hospital: targetHospitalId,
            recipient: (doctor.user as any)._id,
            sender: bookingReq.user!._id,
            type: "appointment_request",
            message: detailedMsg,
            relatedId: appointment._id as any,
          });

          // Notify Staff (Helpdesk, Master Helpdesk, Admin)
          const staffToNotify = await (
            User.find({
              $or: [
                { hospital: targetHospitalId },
                { role: { $in: ["masterhelpdesk", "super-admin"] } },
              ],
              role: {
                $in: [
                  "helpdesk",
                  "masterhelpdesk",
                  "hospital-admin",
                  "super-admin",
                ],
              },
            }) as any
          )
            .unscoped()
            .select("_id role")
            .lean();

          for (const staff of staffToNotify) {
            // Avoid duplicate if doctor is also an admin (though rare in this system)
            if (staff._id.toString() === (doctor.user as any)._id.toString())
              continue;

            await createNotification(bookingReq as any, {
              hospital: targetHospitalId,
              recipient: staff._id,
              sender: bookingReq.user!._id,
              type: "appointment_request",
              message: detailedMsg,
              relatedId: appointment._id as any,
            });
          }

          if (bookingReq.io) {
            // Success feedback to patient
            bookingReq.io
              .to(`patient_${patientId}`)
              .emit("appointment_confirmed", {
                appointmentId: appointment._id,
                message: "Your appointment has been successfully booked!",
              });

            // Refresh Doctor's Dashboard
            bookingReq.io
              .to(`doctor_${(doctor.user as any)._id}`)
              .emit("notification:new", {
                message: `New appointment from ${patientName}`,
                type: "appointment",
              });
          }
        }
      }

      res.status(201).json({
        message: paymentUrl ? "Payment required" : "Appointment request sent",
        appointment,
        paymentUrl,
      });
    } catch (err: any) {
      console.error("Booking Error:", err);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  },
);

export const checkAvailability = asyncHandler(
  async (req: Request, res: Response) => {
    const availabilityReq = req as unknown as AppointmentRequest;
    try {
      const { doctorId, hospitalId, date } = availabilityReq.query;

      console.log("checkAvailability called with:", {
        doctorId,
        hospitalId,
        date,
      });

      if (!doctorId || !hospitalId || !date) {
        console.log("Missing parameters:", { doctorId, hospitalId, date });
        return res.status(400).json({ message: "Missing params" });
      }

      const isHelpdesk =
        availabilityReq.user!.role === "helpdesk" ||
        availabilityReq.user!.role === "hospital-admin";

      const doctor = await DoctorProfile.findById(doctorId).populate("user");
      if (!doctor) {
        console.log("Doctor not found:", doctorId);
        return res.status(404).json({ message: "Doctor not found" });
      }

      console.log("Doctor found:", {
        id: doctor._id,
        name: (doctor.user as any)?.name,
        hasAvailability: !!doctor.availability,
        availabilityCount: doctor.availability?.length || 0,
      });

      const queryDate = new Date(date as string);
      const startOfDay = new Date(queryDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(queryDate.setHours(23, 59, 59, 999));

      if (!doctor.user) {
        console.log("Doctor user record missing:", doctorId);
        return res
          .status(404)
          .json({ message: "Doctor user record not found" });
      }

      const doctorUserId = (doctor.user as any)._id;
      const [leave, masterLeave] = await Promise.all([
        (Leave.findOne({
          requester: doctorUserId,
          status: "approved",
          $or: [{ startDate: { $lte: endOfDay }, endDate: { $gte: startOfDay } }],
        }) as any).unscoped(),
        MasterDoctorLeave.findOne({
          doctor: doctorUserId,
          status: "approved",
          $or: [
            { startDate: { $lte: endOfDay }, endDate: { $gte: startOfDay } },
          ],
        }),
      ]);

      if (leave || masterLeave) {
        return res.json({
          availableSlots: [],
          bookedSlots: [],
          message: "Doctor is on leave",
          isLeave: true,
        });
      }

      const duration = 5; // Enforced 5-minute slots for patient app bookings

      const days = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const dayName = days[queryDate.getDay()];

      // Find availability for this day
      const availability = doctor.availability?.find(
        (a: any) => a.days && a.days.includes(dayName),
      );

      if (!availability) {
        return res.json({
          availableSlots: [],
          bookedSlots: [],
          message: "Doctor not available on this day",
          isLeave: false,
        });
      }

      let startTimeVal = availability.startTime;
      let endTimeVal = availability.endTime;
      let breakStartVal = availability.breakStart;
      let breakEndVal = availability.breakEnd;

      console.log("Doctor availability:", {
        startTimeVal,
        endTimeVal,
        breakStartVal,
        breakEndVal,
      });

      if (!startTimeVal || !endTimeVal) {
        console.log(
          "Invalid availability configuration - missing start or end time",
        );
        return res.json({
          availableSlots: [],
          bookedSlots: [],
          message: "Doctor availability not properly configured",
        });
      }

      const allSlots = generateSlots(
        startTimeVal,
        endTimeVal,
        breakStartVal,
        breakEndVal,
        duration,
      );

      console.log("Generated slots count:", allSlots.length);

      const appointments = await Appointment.find({
        doctor: doctorId,
        hospital: hospitalId,
        date: new Date(date as string),
        status: { $ne: "cancelled" },
      }).select("startTime endTime");

      console.log("Found appointments:", appointments.length);

      const bookedStartTimes = appointments.map((a) => {
        try {
          const d = new Date(`2000-01-01 ${a.startTime}`);
          return d.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
        } catch (e) {
          return a.startTime;
        }
      });
      const hourlyBlocks: any[] = [];
      const slotsByHour: any = {};

      allSlots.forEach((slot) => {
        const [time, modifier] = slot.startTime.split(" ");
        let [h, m]: any = time.split(":").map(Number);
        let hour24 = h;
        if (modifier === "PM" && h < 12) hour24 += 12;
        if (modifier === "AM" && h === 12) hour24 = 0;

        const hourKey = `${hour24}`;
        if (!slotsByHour[hourKey]) {
          slotsByHour[hourKey] = {
            hour24,
            displayStart: `${h}:00 ${modifier}`,
            displayEnd: `${h === 12 ? 1 : h + 1 > 12 ? h + 1 - 12 : h + 1}:00 ${modifier === "AM" && h === 11 ? "PM" : modifier === "PM" && h === 11 ? "AM" : modifier}`,
            slots: [],
          };
        }
        slotsByHour[hourKey].slots.push(slot);
      });

      const bookedCountByHour: any = {};
      appointments.forEach((app) => {
        if (app.startTime) {
          const [time, modifier] = app.startTime.split(" ");
          let [h, m]: any = time.split(":").map(Number);
          if (modifier === "PM" && h < 12) h += 12;
          if (modifier === "AM" && h === 12) h = 0;
          bookedCountByHour[h] = (bookedCountByHour[h] || 0) + 1;
        }
      });

      Object.values(slotsByHour)
        .sort((a: any, b: any) => a.hour24 - b.hour24)
        .forEach((block: any) => {
          const HOURLY_LIMIT = 12;
          const totalCapacity = Math.min(block.slots.length, HOURLY_LIMIT);
          const subSlots = block.slots.map((slot: any) => ({
            startTime: slot.startTime,
            endTime: slot.endTime,
            isBooked: bookedStartTimes.includes(slot.startTime),
          }));

          const bookedCount = subSlots.filter((s: any) => s.isBooked).length;
          const isFull = bookedCount >= totalCapacity;

          hourlyBlocks.push({
            timeSlot: `${block.displayStart} - ${block.displayEnd}`,
            totalCapacity,
            bookedCount,
            isFull,
            availableCount: Math.max(0, totalCapacity - bookedCount),
            subSlots, // Include individual 5-min slots
          });
        });

      console.log("Returning hourly blocks:", hourlyBlocks.length);

      res.json({
        slots: hourlyBlocks,
        bookedCountByHour: isHelpdesk ? bookedCountByHour : undefined,
      });
    } catch (err: any) {
      console.error("checkAvailability error:", err);
      console.error("Stack trace:", err.stack);
      res.status(500).json({
        message: err.message || "Server error",
        error: err.toString(),
      });
    }
  },
);

export const updateAppointmentStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const updateReq = req as unknown as RequestWithIO;
    try {
      const { id } = updateReq.params;
      const { status, reason, duration, vitals, symptoms } = updateReq.body;

      if (
        ![
          "confirmed",
          "rejected",
          "cancelled",
          "completed",
          "in-progress",
        ].includes(status)
      ) {
        return res.status(400).json({ message: "Invalid status" });
      }

      let updateData: any = {
        status:
          status === "rejected" || status === "cancelled"
            ? "cancelled"
            : status,
      };

      if (reason) updateData.reason = reason;
      if (symptoms) updateData.symptoms = Array.isArray(symptoms) ? symptoms : [symptoms];
      if (vitals) {
        // --- Backend Validation for Vitals ---
        const errors: string[] = [];
        const h = Number(vitals.height);
        const w = Number(vitals.weight);
        const p = Number(vitals.pulse);
        const s = Number(vitals.spo2 || vitals.spO2);
        const t = Number(vitals.temperature);
        const bp = vitals.bp || vitals.bloodPressure;

        if (vitals.height && (isNaN(h) || h < 20 || h > 300)) errors.push("Height must be 20-300cm");
        if (vitals.weight && (isNaN(w) || w < 1 || w > 500)) errors.push("Weight must be 1-500kg");
        if (vitals.pulse && (isNaN(p) || p < 30 || p > 250)) errors.push("Pulse must be 30-250 bpm");
        if ((vitals.spo2 || vitals.spO2) && (isNaN(s) || s < 50 || s > 100)) errors.push("SpO2 must be 50-100%");
        if (vitals.temperature && (isNaN(t) || t < 90 || t > 110)) errors.push("Temperature must be 90-110°F");
        if (bp && !/^\d{2,3}\/\d{2,3}$/.test(bp)) errors.push("Blood Pressure must be in XXX/XX format");

        if (errors.length > 0) {
          return res.status(400).json({ 
            success: false, 
            message: "Validation Failed", 
            errors 
          });
        }

        updateData.vitals = {
          bloodPressure: bp,
          temperature: vitals.temperature,
          pulse: vitals.pulse,
          spO2: vitals.spo2 || vitals.spO2,
          height: vitals.height,
          weight: vitals.weight,
          glucose: vitals.sugar || vitals.glucose
        };
      }


      if (status === "in-progress") {
        updateData.consultationStartTime = new Date();
      } else if (status === "completed") {
        updateData.consultationEndTime = new Date();
        if (duration) {
          updateData.consultationDuration = duration;
        }
      }

      let appointment = await (
        Appointment.findByIdAndUpdate(id, updateData, { new: true }) as any
      ).unscoped();

      // If not found in standard Appointment, check MobileAppointment
      if (!appointment) {
        appointment = await (
          MobileAppointment.findByIdAndUpdate(
            id,
            {
              ...updateData,
              status:
                status === "rejected" || status === "cancelled"
                  ? "Cancelled"
                  : ((status.charAt(0).toUpperCase() + status.slice(1)) as any),
            },
            { new: true },
          ) as any
        ).unscoped();
      }

      // 🔐 CLINICAL SYNC: Update Patient Profile with latest vitals if provided
      if (appointment && vitals) {
        try {
          const patientId = appointment.patient?._id || appointment.patient;
          const hospitalId = appointment.hospital;

          if (patientId && hospitalId) {
            await (PatientProfile.findOneAndUpdate(
              { user: patientId, hospital: hospitalId },
              {
                $set: {
                  bloodPressure: vitals.bp || vitals.bloodPressure,
                  temperature: vitals.temperature,
                  pulse: vitals.pulse,
                  spO2: vitals.spo2 || vitals.spO2,
                  height: vitals.height,
                  weight: vitals.weight,
                  sugar: vitals.sugar || vitals.glucose,
                  lastVisit: new Date()
                }
              },
              { upsert: true }
            ) as any).unscoped();

            console.log(`[ClinicalSync] Updated PatientProfile for patient ${patientId}`);
          }
        } catch (syncErr) {
          console.error("[ClinicalSync] Failed to sync vitals to profile:", syncErr);
        }
      }

      // If status is completed and no duration was provided in body, calculate it from existing startTime
      if (
        appointment &&
        status === "completed" &&
        !duration &&
        appointment.consultationStartTime
      ) {
        const endTime = updateData.consultationEndTime || new Date();
        const calculatedDuration = Math.floor(
          (endTime.getTime() -
            new Date(appointment.consultationStartTime).getTime()) /
            1000,
        );

        // Update with calculated duration
        appointment = await (appointment.constructor as any)
          .findByIdAndUpdate(
            id,
            { consultationDuration: calculatedDuration },
            { new: true },
          )
          .unscoped();
      }

      if (appointment) {
        const isMobile =
          (appointment as any).constructor.modelName === "MobileAppointment";

        const patientPopulate: any = {
          path: "patient",
          options: { strictPopulate: false },
        };

        // Only MobileAppointment uses PatientProfile which has a 'user' field referring to Patient
        if (isMobile) {
          patientPopulate.populate = {
            path: "user",
            select: "name email mobile",
          };
        }

        appointment = await (appointment as any).constructor
          .findById(id)
          .populate(patientPopulate)
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          });
      }

      if (!appointment)
        return res.status(404).json({ message: "Appointment not found" });

      const dateStr = new Date(appointment.date).toDateString();
      const timeSlotStr = `${appointment.startTime} - ${appointment.endTime}`;

      if (appointment.patient) {
        const patientObj = appointment.patient as any;
        const patientId = patientObj._id || appointment.patient;
        let msg = "";
        let notifType = "appointment_status_change";

        const patientName =
          (appointment.patient as any)?.name ||
          (appointment.patient as any)?.user?.name ||
          "Patient";
        const doctorName = (appointment.doctor as any)?.name || "Doctor";
        const appType = appointment.type || appointment.visitType || "OPD";

        if (status === "confirmed") {
          msg = `${appType} Appointment Confirmed: Patient: ${patientName}, Doctor: ${doctorName}, Date: ${dateStr}, Time: ${timeSlotStr}, Status: Confirmed`;
          notifType = "appointment_confirmed";
        } else if (status === "completed") {
          msg = `${appType} Appointment Completed: Patient: ${patientName}, Doctor: ${doctorName}, Date: ${dateStr}, Time: ${timeSlotStr}, Status: Completed`;
          notifType = "appointment_completed";
        } else {
          msg = `${appType} Appointment Cancelled: Patient: ${patientName}, Doctor: ${doctorName}, Date: ${dateStr}, Time: ${timeSlotStr}, Status: Cancelled. ${reason ? `Reason: ${reason}` : ""}`;
          notifType = "appointment_cancelled";
        }

        try {
          await createNotification(updateReq as any, {
            hospital: appointment.hospital,
            recipient: patientId,
            sender: updateReq.user!._id,
            type: notifType,
            message: msg,
            relatedId: appointment._id as any,
          });

          if (updateReq.io) {
            updateReq.io
              .to(`patient_${patientId}`)
              .emit("appointment:status_change", {
                appointmentId: id,
                status: status === "rejected" ? "cancelled" : status,
                reason,
              });
          }
        } catch (notifErr) {
          console.error(
            "[Status Update] Patient notification error:",
            notifErr,
          );
        }
      }

      try {
        const isMobile =
          (appointment as any).constructor.modelName === "MobileAppointment";

        const patientPopulate: any = {
          path: "patient",
          options: { strictPopulate: false },
        };

        if (isMobile) {
          patientPopulate.populate = {
            path: "user",
            select: "name email mobile",
          };
        }

        const fullAppointment = await Appointment.findById(id)
          .populate(patientPopulate)
          .populate({
            path: "doctor",
            populate: { path: "user" },
          });

        if (
          fullAppointment &&
          fullAppointment.doctor &&
          (fullAppointment.doctor as any).user
        ) {
          const dateStr = new Date(appointment.date).toDateString();
          const timeSlotStr = `${appointment.startTime} - ${appointment.endTime}`;
          const patientName =
            (fullAppointment.patient as any)?.name ||
            (fullAppointment.patient as any)?.user?.name ||
            "Patient";
          const doctorName =
            (fullAppointment.doctor as any)?.user?.name || "Doctor";
          const appType =
            fullAppointment.type || fullAppointment.visitType || "OPD";

          const formatStatus = (s: string) => {
            if (!s) return "";
            return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
          };
          const formattedStatus = formatStatus(status);
          const detailedMsg = `${appType} Appointment Update: Patient: ${patientName}, Doctor: ${doctorName}, Date: ${dateStr}, Time: ${timeSlotStr}, Status: ${formattedStatus}`;

          // Notify Doctor
          await createNotification(updateReq as any, {
            hospital: appointment.hospital,
            recipient: (fullAppointment.doctor as any).user._id,
            sender: updateReq.user!._id,
            type: "system_alert",
            message: detailedMsg,
            relatedId: appointment._id as any,
          });

          // Notify Staff (Helpdesk, Master Helpdesk, Admin)
          const staffToNotify = await (
            User.find({
              $or: [
                { hospital: appointment.hospital },
                { role: { $in: ["masterhelpdesk", "super-admin"] } },
              ],
              role: {
                $in: [
                  "helpdesk",
                  "masterhelpdesk",
                  "hospital-admin",
                  "super-admin",
                ],
              },
            }) as any
          )
            .unscoped()
            .select("_id role")
            .lean();

          for (const staff of staffToNotify) {
            // Avoid duplicate if staff is already notified as recipient (patient/doctor)
            const doctorUserId =
              (fullAppointment.doctor as any)?.user?._id ||
              (fullAppointment.doctor as any)?.user;
            if (
              doctorUserId &&
              staff._id.toString() === doctorUserId.toString()
            )
              continue;

            await createNotification(updateReq as any, {
              hospital: appointment.hospital,
              recipient: staff._id,
              sender: updateReq.user!._id,
              type: "system_alert",
              message: detailedMsg,
              relatedId: appointment._id as any,
            });
          }
          if (updateReq.io) {
            updateReq.io
              .to(`doctor_${(fullAppointment.doctor as any).user._id}`)
              .emit("appointment:update", {
                appointmentId: id,
                status: status === "rejected" ? "cancelled" : status,
              });
            // Force Dashboard Refresh
            updateReq.io
              .to(`doctor_${(fullAppointment.doctor as any).user._id}`)
              .emit("dashboard:update", {
                message: `Appointment status updated to ${status}`,
                appointmentId: id,
              });
          }
        }
      } catch (staffNotifErr) {
        console.error(
          "[Status Update] Staff/Doctor notification error:",
          staffNotifErr,
        );
      }

      if (updateReq.io) {
        try {
          updateReq.io.emit("appointment_status_changed", {
            appointmentId: id,
            status: status === "rejected" ? "cancelled" : status,
            doctorName: "Doctor", // Fallback to safe string
            hospitalId:
              (appointment.hospital as any)?._id ||
              (appointment.hospital as any),
          });

          // Also Notify helpdesk via hospital room
          const hospitalId =
            (appointment.hospital as any)?._id || (appointment.hospital as any);
          if (hospitalId) {
            const hospitalRoom = `hospital_${hospitalId}`;
            updateReq.io.to(hospitalRoom).emit("dashboard:update", {
              message: `Appointment status updated to ${status}`,
              appointmentId: id,
            });
          }

          const patientId =
            (appointment.patient as any)?._id || (appointment.patient as any);
          const targetRoom = `patient_${patientId}`;
          if (patientId && updateReq.io) {
            if (status === "confirmed") {
              updateReq.io.to(targetRoom).emit("appointment_confirmed", {
                appointmentId: id,
                message: `Your appointment on ${dateStr} at ${timeSlotStr} has been confirmed.`,
              });
            } else if (status === "rejected" || status === "cancelled") {
              updateReq.io.to(targetRoom).emit("appointment_cancelled", {
                appointmentId: id,
                message: `Your appointment on ${dateStr} at ${timeSlotStr} was cancelled. ${reason ? `Reason: ${reason}` : ""}`,
              });
            }
          }

          // 🚀 INVALIDATE CACHE: Ensure doctor dashboard updates in real-time
          // This is also risky if Redis is down, but invalidateDoctorCache has its own try-catch
          const fullAppointment =
            await Appointment.findById(id).populate("doctor");
          if (fullAppointment?.doctor) {
            const doctorUserId = (fullAppointment.doctor as any)?.user;
            if (doctorUserId)
              await invalidateDoctorCache(doctorUserId.toString());
          }
        } catch (socketErr) {
          console.error("[Status Update] Socket error:", socketErr);
        }
      }

      res.json({ message: `Appointment ${status}`, appointment });
    } catch (err: any) {
      console.error("Update Status Error:", err);
      res.status(500).json({
        message: "Server error",
        error: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      });
    }
  },
);

// ─── GENERIC: PATIENT & DOCTOR APPOINTMENTS ─────────────────────────────────
export const getAppointments = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const appsReq = req as unknown as AppointmentRequest;
    try {
      const { role, _id } = appsReq.user!;

      // DELEGATION: Redirect Helpdesk queries to specialized controllers
      if (role === "masterhelpdesk")
        return getMasterHelpdeskAppointments(req, res, next);
      if (role === "helpdesk" || role === "hospital-admin")
        return getHelpdeskAppointments(req, res, next);

      let query: any = {};
      if (role === "patient") query.patient = _id;
      else if (role === "doctor") {
        const dp = await (DoctorProfile.findOne({ user: _id }) as any);
        if (!dp) {
          // SECURITY: Prevent returning all appointments if doctor profile is missing
          query.doctor = new mongoose.Types.ObjectId();
        } else {
          query.doctor = dp._id;
        }
      }

      const searchQuery = (req.query.query as string) || (req.query.search as string) || "";
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const sortOrder = req.query.sort === "oldest" || req.query.sort === "asc" ? 1 : -1;
      const skip = (page - 1) * limit;
      console.log(`[getAppointments] Page=${page}, Limit=${limit}, Skip=${skip}, Sort=${sortOrder}, Role=${role}, Query=${JSON.stringify(query)}`);
      const userRole = role;

      if (searchQuery) {
        // Find patients matching the name or ID - EXPLICITLY UNSCOPED for global patient lookup
        let matchingPatients: any[] = [];
        try {
          const patientSearchQuery = {
            $or: [
              { name: { $regex: searchQuery, $options: "i" } },
              { mobile: { $regex: searchQuery, $options: "i" } },
              { email: { $regex: searchQuery, $options: "i" } },
            ],
          };

          // Try to use unscoped if available (via plugin), otherwise fallback to regular find
          const patientFind = Patient.find(patientSearchQuery);
          matchingPatients = await ((patientFind as any).unscoped
            ? (patientFind as any).unscoped().select("_id")
            : patientFind.select("_id"));
        } catch (e) {
          console.error("[getAppointments] Patient search error:", e);
          // Fallback if Patient search fails
          matchingPatients = [];
        }

        const patientIds = matchingPatients.map((p: any) => p._id);

        query.$or = [
          { mrn: { $regex: searchQuery, $options: "i" } },
          { patient: { $in: patientIds } },
          { "patientDetails.name": { $regex: searchQuery, $options: "i" } },
          { "patientDetails.mobile": { $regex: searchQuery, $options: "i" } },
          { reason: { $regex: searchQuery, $options: "i" } },
          { appointmentId: { $regex: searchQuery, $options: "i" } },
        ];
      }

      if (req.query.status) {
        query.status = { $regex: req.query.status as string, $options: "i" };
      }

      if (req.query.date) {
        const dateStr = req.query.date as string;
        const startDate = new Date(dateStr);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(dateStr);
        endDate.setHours(23, 59, 59, 999);
        query.date = { $gte: startDate, $lte: endDate };
        console.log(
          `[getAppointments] Date Filter: ${startDate.toISOString()} to ${endDate.toISOString()}`,
        );
      } else {
        // Default to today and future for doctor/patient if no date specified
        // to keep it "fresh" unless it's an admin looking for history
        if (userRole === "doctor" || userRole === "patient") {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          // query.date = { $gte: today }; // Still optional, let's keep it historcial for now as per previous request
        }
      }

      const typeFilter = (req.query.type as string) || "all";
      const isFilteringByType = typeFilter !== "all";

      let total = 0;
      let results: any[] = [];

      // --- Unified Model Fetching ---
      // IMPORTANT: When combining results from 2 collections, we CANNOT apply
      // skip/limit independently to each. Instead we fetch all from both,
      // combine, sort, then paginate the combined result.
      const fetchAppointments = async () => {
        return Appointment.find(query)
          .sort({ date: sortOrder, createdAt: sortOrder })
          .populate({ path: "patient", select: "name mobile email" })
          .populate("hospital", "name")
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          })
          .lean();
      };

      const fetchMobileAppointments = async () => {
        // Adapt query for MobileAppointment (refers to PatientProfile)
        const mobileQuery = { ...query };
        if (mobileQuery.patient) {
          // Find PatientProfile matching that user ID
          const profile = await PatientProfile.findOne({
            user: mobileQuery.patient,
          })
            .select("_id")
            .lean();
          if (profile) mobileQuery.patient = profile._id;
        }

        return MobileAppointment.find(mobileQuery)
          .sort({ date: sortOrder, createdAt: sortOrder })
          .populate("patient") // Path to PatientProfile
          .populate("hospital", "name")
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          })
          .lean();
      };

      const [apps, mobileApps] = await Promise.all([
        fetchAppointments(),
        fetchMobileAppointments(),
      ]);

      console.log(`[getAppointments] Results: Appointments=${apps.length}, MobileApps=${mobileApps.length}, Page=${page}, Skip=${skip}`);

      // ── Global Patient Name Synchronization ────────────────────────────────
      const allUserIds = [
        ...apps.map((apt: any) => apt.patient?._id || apt.patient),
        ...mobileApps.map((m: any) => m.patient?.user?._id || m.patient?.user),
      ].filter((id) => id);

      const patientQuery = Patient.find({ _id: { $in: allUserIds } });
      const globalPatients = await (
        (patientQuery as any).unscoped ? (patientQuery as any).unscoped() : patientQuery
      );
      const userNameMap = new Map(
        globalPatients.map((p: any) => [p._id.toString(), p.name]),
      );

      // Normalize MobileAppointments to match Appointment structure
      const normalizedMobile = mobileApps.map((m: any) => {
        let userId = m.patient?.user?._id || m.patient?.user;
        let pName =
          userNameMap.get(userId?.toString()) ||
          (m.patient as any)?.user?.name ||
          m.patientDetails?.name ||
          "Unknown";

        return {
          ...m,
          id: m._id,
          isOnline: true,
          patient: {
            _id: userId,
            name: pName,
            mobile:
              (m.patient as any)?.user?.mobile ||
              m.patientDetails?.mobile ||
              "N/A",
          },
          patientName: pName,
          doctor: m.doctor
            ? {
                _id: m.doctor._id,
                name: (m.doctor as any).user?.name || "Pending",
              }
            : null,
          mrn: m.mrn || m.patient?.mrn || "N/A",
          timeSlot:
            m.startTime && m.endTime
              ? `${m.startTime} - ${m.endTime}`
              : m.startTime || "N/A",
        };
      });

      // Combine and sort ALL results from both collections
      let combined = [...apps, ...normalizedMobile];

      combined.sort((a: any, b: any) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return sortOrder === 1 ? dateA - dateB : dateB - dateA;
      });

      // Use the ACTUAL combined count for pagination (most accurate)
      total = combined.length;

      // Apply pagination on the combined sorted result
      results = combined.slice(skip, skip + limit);

      console.log(`[getAppointments] Total=${total}, Page=${page}, Showing=${results.length}`);

      const totalPagesCount = Math.ceil(total / limit);

      const enrichedAppointments = results.map((app: any) => {
        const patientUserId = app.patient?._id || app.patient;
        const pName =
          userNameMap.get(patientUserId?.toString()) ||
          app.patientName ||
          app.patient?.name ||
          "Unknown";

        const timeVal =
          app.timeSlot ||
          (app.startTime && app.endTime
            ? `${app.startTime} - ${app.endTime}`
            : app.appointmentTime || app.startTime || "N/A");

        return {
          ...app,
          id: app._id,
          timeSlot: timeVal,
          time: timeVal,
          patientName: pName,
          doctorName:
            app.doctorName ||
            app.doctor?.user?.name ||
            app.doctor?.name ||
            "Pending",
          patient: {
            ...app.patient,
            _id: patientUserId,
            name: pName,
            mrn: app.mrn || "N/A",
          },
          doctor: {
            ...app.doctor,
            _id: app.doctor?._id || app.doctor,
          },
          hospital: app.hospital?.name || "N/A",
          patientType:
            app.isIPD || app.type?.toUpperCase() === "IPD" ? "IPD" : "OPD",
        };
      });

      (req as any).markStage?.("mapping-done");

      res.json({
        success: true,
        data: enrichedAppointments,
        pagination: {
          total,
          page,
          limit,
          totalPages: totalPagesCount,
        },
      });
    } catch (err: any) {
      console.error("[getAppointments] CRITICAL Error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Ensure we NEVER return an empty object {} even if JSON.stringify(err) would do that
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Internal server error while fetching appointments",
          error: errorMsg,
          details:
            process.env.NODE_ENV === "development"
              ? err.stack || "No stack trace available"
              : undefined,
        });
      }
    }
  },
);

export const getAppointmentById = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const isMasterUser = (req as any).user?.role === "masterhelpdesk" || (req as any).user?.role === "super-admin";

      let query = Appointment.findById(id);
      if (isMasterUser) {
        query = (query as any).unscoped();
      }

      let appointment = await query
        .populate("patient", "name mobile email age gender")
        .populate({
          path: "doctor",
          populate: { path: "user", select: "name" },
        })
        .populate("hospital", "name address")
        .lean();

      if (!appointment) {
        // Check MobileAppointment
        let mobileQuery = MobileAppointment.findById(id);
        if (isMasterUser) {
          mobileQuery = (mobileQuery as any).unscoped();
        }

        const mobileApp = await mobileQuery
          .populate({
            path: "patient",
            model: "PatientProfile",
            populate: { path: "user", select: "name mobile email" },
          })
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          })
          .populate("hospital", "name address")
          .lean();

        if (!mobileApp) {
          return res.status(404).json({ message: "Appointment not found" });
        }

        // Normalize mobile app to match expectation
        appointment = {
          ...(mobileApp as any),
          patient: (mobileApp as any).patient?.user || (mobileApp as any).patient,
          patientProfile: (mobileApp as any).patient,
          timeSlot: `${(mobileApp as any).startTime} - ${(mobileApp as any).endTime}`,
          isOnline: true,
          // Normalize clinical narrative
          reason: (mobileApp as any).reason || (mobileApp as any).notes || "",
          // Normalize vitals keys
          vitals: {
            ...(mobileApp as any).vitals,
            bloodPressure: (mobileApp as any).vitals?.bp || (mobileApp as any).vitals?.bloodPressure,
            glucose: (mobileApp as any).vitals?.glucose || (mobileApp as any).vitals?.sugar,
            height: (mobileApp as any).vitals?.height || "",
          }
        } as any;
      }

      // Normalize if needed, similar to getAppointments
      const app: any = appointment;
      if (!app.timeSlot) app.timeSlot = `${app.startTime || app.appointmentTime} - ${app.endTime || app.appointmentTime}`;

      // Ensure we fetch PatientProfile for missing details like MRN/Age if they aren't on User
      if (app.patient) {
        try {
          const profile = await PatientProfile.findOne({
            user: (app.patient as any)._id,
          });

          if (profile) {
            console.log(
              `[BookingController] Found Profile. DOB: ${profile.dob}`,
            );

            // Manual age calculation to be fail-safe
            let derivedAge: number | null = null;
            if (profile.dob) {
              const diff = Date.now() - new Date(profile.dob).getTime();
              derivedAge = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
            }

            // Use Virtual if available, else Manual
            const finalAge = profile.age || derivedAge;

            if (finalAge) {
              app.patient.age = finalAge;
            }

            if (!app.patient.gender && profile.gender)
              app.patient.gender = profile.gender;
            if (!app.patient.mrn && profile.mrn) app.patient.mrn = profile.mrn;

            // Also ensure top-level MRN on appointment if missing
            if (!app.mrn && profile.mrn) app.mrn = profile.mrn;

            // Attach profile for frontend fallback
            app.patientProfile = profile;
            
            // Normalize vitals if they exist on appointment
            if (app.vitals) {
              app.vitals.bloodPressure = app.vitals.bloodPressure || app.vitals.bp;
              app.vitals.glucose = app.vitals.glucose || app.vitals.sugar;
            }
          } else {
            console.log(
              `[BookingController] No PatientProfile found for user ${(app.patient as any)._id}`,
            );
          }
        } catch (pErr) {
          console.error("Error fetching patient profile in details:", pErr);
        }

        // Check if patientDetails overrides exist (Walk-in/Helpdesk specific)
        if (app.patientDetails && app.patientDetails.name)
          (app.patient as any).name = app.patientDetails.name;
        if (app.patientDetails && app.patientDetails.age)
          (app.patient as any).age = app.patientDetails.age;
        if (app.patientDetails && app.patientDetails.gender)
          (app.patient as any).gender = app.patientDetails.gender;
      }

      res.json(app);
    } catch (err: any) {
      console.error("Error fetching appointment details:", err);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  },
);

export const getHospitalAppointmentStats = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { date, range, startDate, endDate } = req.query;

      const targetHospitalId = (req as any).user?.hospital;
      const hospital = await Hospital.findById(targetHospitalId);
      if (!hospital)
        return res.status(404).json({ message: "Clinic settings not found" });
      const hospitalId = hospital._id;

      if (!date && !startDate) {
        return res.status(400).json({ message: "Date is required" });
      }

      const selectedDate = new Date(date as string);

      if (range === "week") {
        const endDate = new Date(selectedDate);
        endDate.setHours(23, 59, 59, 999);

        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);

        const appointments = await Appointment.find({
          hospital: hospitalId,
          date: { $gte: startDate, $lte: endDate },
          status: { $ne: "cancelled" },
        })
          .populate("patient", "name")
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          })
          .lean();

        const dailyStatsMap: any = {};
        for (
          let d = new Date(startDate);
          d <= endDate;
          d.setDate(d.getDate() + 1)
        ) {
          const dateStr = d.toISOString().split("T")[0];
          dailyStatsMap[dateStr] = 0;
        }

        const doctorStatsMap: any = {};

        appointments.forEach((app: any) => {
          const appDate = new Date(app.date).toISOString().split("T")[0];
          if (dailyStatsMap[appDate] !== undefined) {
            dailyStatsMap[appDate]++;
          } else {
            dailyStatsMap[appDate] = 1;
          }

          const docName = (app.doctor as any)?.user?.name || "Unknown Doctor";
          doctorStatsMap[docName] = (doctorStatsMap[docName] || 0) + 1;
        });

        const dailyStats = Object.keys(dailyStatsMap)
          .sort()
          .map((dateStr) => ({
            date: dateStr,
            count: dailyStatsMap[dateStr],
          }));

        const topDoctors = Object.entries(doctorStatsMap)
          .map(([name, count]: any) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        return res.json({
          period: "week",
          totalPatients: appointments.length,
          dailyStats,
          topDoctors,
        });
      }

      const query: any = {
        hospital: hospitalId,
        status: { $ne: "cancelled" },
      };

      if (startDate && endDate) {
        const start = new Date(startDate.toString());
        start.setHours(0, 0, 0, 0);

        const end = new Date(endDate.toString());
        end.setHours(23, 59, 59, 999);

        query.date = {
          $gte: start,
          $lte: end,
        };
      } else {
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);

        query.date = {
          $gte: startOfDay,
          $lte: endOfDay,
        };
      }

      const dailyAppointments = await Appointment.find(query)
        .populate("patient", "name mobile age gender")
        .populate({
          path: "doctor",
          populate: {
            path: "user",
            select: "name",
          },
        })
        .lean();

      const hourlyStats = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        count: 0,
        appointments: [],
      }));

      for (const app of dailyAppointments) {
        if (!app.startTime) continue;

        const [time, modifier] = app.startTime.split(" ");
        let [hours, minutes] = time.split(":").map(Number);

        if (modifier === "PM" && hours !== 12) hours += 12;
        if (modifier === "AM" && hours === 12) hours = 0;

        if (hours >= 0 && hours < 24) {
          (hourlyStats[hours] as any).count++;

          (hourlyStats[hours] as any).appointments.push({
            _id: app._id,
            patient: app.patient,
            patientDetails: app.patientDetails,
            doctorName: (app.doctor as any)?.user?.name || "Unknown Doctor",
            timeSlot: `${app.startTime} - ${app.endTime}`,
            reason: app.reason,
            urgency: app.urgency,
            status: app.status,
          });
        }
      }

      res.json(hourlyStats);
    } catch (err) {
      console.error("Error fetching hospital stats:", err);
      res.status(500).json({ message: "Server error" });
    }
  },
);

export const checkFollowUpEligibility = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const hospitalId = (req as any).tenantId || (req as any).user.hospital;
      const { patientId, doctorId, type, date } = req.query;

      if (!hospitalId || !patientId) {
        return res.status(400).json({ message: "Hospital and Patient ID required" });
      }

      // Verify hospital exists before delegating (gives a cleaner 404 than the helper's thrown error)
      const hospitalExists = await Hospital.findById(hospitalId)
        .select("_id")
        .lean();
      if (!hospitalExists) {
        return res.status(404).json({ message: "Hospital not found" });
      }

      // Delegate ALL business logic to the shared helper so there is exactly one
      // place where follow-up rules live. The response shape is identical to before.
      const status = await computeFollowUpStatus(
        String(hospitalId),
        String(patientId),
        doctorId ? String(doctorId) : undefined,
        date ? new Date(String(date)) : new Date(),
        String(type || "OPD"),
      );

      console.log(`[FollowUp] patientId=${patientId} doctorId=${doctorId} hospitalId=${hospitalId}`);
      console.log(`[FollowUp] eligible=${status.eligible} rangeDays=${status.rangeDays} expiryDate=${status.expiryDate}`);

      return res.json({
        eligible:              status.eligible,
        enableExpiry:          status.enableExpiry,
        diffDays:              status.diffDays,
        rangeDays:             status.rangeDays,
        lastAppointmentDate:   status.lastAppointmentDate,
        lastAppointmentDoctor: status.lastAppointmentDoctor,
        expiryDate:            status.expiryDate,
        visitCount:            status.visitCount,
        doctorVisitCount:      status.doctorVisitCount,
        visitCalculations:     status.visitCalculations,
        message:               status.message,
        remainingDays:         status.remainingDays,
      });
    } catch (error: any) {
      console.error("[checkFollowUpEligibility] Error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);
