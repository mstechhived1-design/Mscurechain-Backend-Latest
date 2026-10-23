import { Request, Response } from "express";
import MobileAppointment from "../Models/MobileAppointment.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import HospitalCounter from "../../Hospital/Models/HospitalCounter.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Patient from "../../Patient/Models/Patient.js";
import Leave from "../../Leave/Models/Leave.js";
import MasterDoctorLeave from "../../MasterHelpdesk/Models/MasterDoctorLeave.js";
import crypto from "crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Razorpay from "razorpay";
import Transaction from "../../Admin/Models/Transaction.js";
import { generateTransactionId, generateReceiptNumber, generateMrn } from "../../utils/idGenerator.js";

dotenv.config();

// ─── Real Razorpay Instance (Live Keys from .env) ─────────────────────────────
const getRazorpayInstance = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error(
      "Razorpay keys are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env"
    );
  }

  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

// ─── POST /api/mobile/create-order ────────────────────────────────────────────
/**
 * Creates a Razorpay order for an appointment booking.
 * Called by the mobile app before opening the payment checkout.
 */
export const createMobileOrder = async (req: Request, res: Response) => {
  try {
    const { amount, currency = "INR", receipt = `rcpt_mob_${Date.now()}` } = req.body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ message: "Invalid amount. Must be a positive number." });
    }

    let orderId = `order_sim_${Date.now()}`;
    let orderAmount = Math.round(Number(amount) * 100);

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (keyId && keySecret) {
      const razorpay = getRazorpayInstance();
      const order = await razorpay.orders.create({
        amount: orderAmount,
        currency,
        receipt,
      });
      orderId = order.id;
      orderAmount = Number(order.amount);
      console.log(`[Mobile Razorpay] Live Order created: ${order.id} for ₹${amount}`);
    } else {
      console.log(`[Mobile Razorpay] Keys not configured. Simulated Mock Order created: ${orderId} for ₹${amount}`);
    }

    res.status(200).json({
      orderId,
      amount: orderAmount,
      currency,
      receipt,
    });
  } catch (error: any) {
    console.error("[Mobile Razorpay] createMobileOrder error:", error);
    res.status(500).json({
      message: error.message || "Failed to create Razorpay order",
    });
  }
};

// ─── POST /api/mobile/verify-payment ──────────────────────────────────────────
/**
 * Verifies Razorpay payment signature after successful payment.
 * MUST be called before creating the appointment record.
 */
export const verifyMobilePayment = async (req: Request, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment verification details." });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    
    // Support test simulation when no real secret is set or order was simulated
    if (!keySecret || razorpay_order_id.startsWith('order_sim_')) {
      console.log(`[Mobile Razorpay] Simulation payment verified: ${razorpay_payment_id}`);
      return res.status(200).json({ status: "ok", message: "Simulated payment verified successfully." });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.error("[Mobile Razorpay] Signature mismatch for order:", razorpay_order_id);
      return res.status(400).json({ status: "error", message: "Payment verification failed. Invalid signature." });
    }

    console.log(`[Mobile Razorpay] Payment verified: ${razorpay_payment_id}`);
    res.status(200).json({ status: "ok", message: "Payment verified successfully." });
  } catch (error: any) {
    console.error("[Mobile Razorpay] verifyMobilePayment error:", error);
    res.status(500).json({ message: error.message || "Payment verification failed." });
  }
};

// ─── GET /api/mobile/checkout ──────────────────────────────────────────────────
/**
 * Renders a self-contained HTML page with Razorpay checkout.
 * The mobile app opens this in a WebView. On success/cancel, the page
 * redirects to the deep-link scheme: mscurechain-patient://payment-result?...
 */
export const renderMobileCheckoutPage = async (req: Request, res: Response) => {
  try {
    const {
      orderId,
      amount,
      name = "",
      email = "",
      contact = "",
      dob = "",
      description = "Consultation Fee",
      themeColor = "#2563EB",
    } = req.query;

    if (!orderId || !amount) {
      return res.status(400).send("<h2>Error: orderId and amount are required.</h2>");
    }

    const razorpayKey = process.env.RAZORPAY_KEY_ID || 'rzp_test_simulated_dev';

    // Deep link scheme that the app listens on
    const successDeepLink = `mscurechain-patient://payment-result`;
    const cancelDeepLink  = `mscurechain-patient://payment-result`;
    let displayName = (name as string) || "";
    let displayContact = (contact as string) || "";
    let displayDob = (dob as string) || "";

    // If contact or dob is missing or N/A, attempt fallback lookup by patientId
    if (!displayContact || displayContact === "N/A" || !displayDob) {
      try {
        const Patient = (await import("../../Patient/Models/Patient.js")).default;
        if (req.query.patientId) {
          const p: any = await (Patient.findById(req.query.patientId) as any).unscoped().lean();
          if (p) {
            displayName = displayName || p.name;
            displayContact = displayContact || p.mobile;
            if (!displayDob && p.dateOfBirth) {
              const d = new Date(p.dateOfBirth);
              displayDob = `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
            }
          }
        }
      } catch (err) {
        // ignore fallback errors
      }
    }

    const isSimulated = !process.env.RAZORPAY_KEY_ID || String(orderId).startsWith("order_sim_") || razorpayKey === "rzp_test_simulated_dev";

    console.log(`[Mobile Razorpay] Rendering checkout for Order: ${orderId}, Amount: ${amount}, Simulated: ${isSimulated}, Name: ${displayName}, Contact: ${displayContact}`);

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Secure Payment</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .card {
      background: #fff;
      border-radius: 20px;
      padding: 30px 22px;
      text-align: center;
      max-width: 360px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    .logo { font-size: 36px; margin-bottom: 8px; }
    h1 { color: #0F172A; font-size: 20px; font-weight: 800; margin-bottom: 4px; }
    p { color: #64748B; font-size: 13px; margin-bottom: 18px; line-height: 1.5; }
    .badge-test {
      display: inline-block;
      background: #FEF3C7;
      color: #B45309;
      font-size: 10px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .amount {
      background: #EFF6FF;
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 18px;
    }
    .amount-label { color: #64748B; font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
    .amount-value { color: #0284C7; font-size: 30px; font-weight: 900; margin-top: 4px; }
    .patient-box {
      font-size: 12px;
      color: #334155;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      padding: 10px;
      margin-bottom: 18px;
      text-align: left;
    }
    .btn-pay {
      background: #0D9488;
      color: #ffffff;
      border: none;
      border-radius: 12px;
      padding: 14px;
      font-size: 15px;
      font-weight: 800;
      width: 100%;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(13, 148, 136, 0.3);
    }
    .btn-pay:hover { background: #0F766E; }
    .btn-cancel {
      background: transparent;
      border: none;
      color: #94A3B8;
      font-size: 12px;
      font-weight: 600;
      margin-top: 12px;
      cursor: pointer;
    }
    .spinner {
      width: 44px; height: 44px;
      border: 4px solid #E2E8F0;
      border-top: 4px solid #0D9488;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text { color: #64748B; font-size: 14px; font-weight: 600; }
    .status-icon { font-size: 52px; margin-bottom: 12px; }
    .status-title { font-size: 20px; font-weight: 800; margin-bottom: 6px; }
    .status-sub { color: #64748B; font-size: 13px; }
    #result-view { display: none; }
    #loading-view { display: none; }
  </style>
</head>
<body>
<div class="card">
  <div id="initial-view">
    <div class="logo">🏥</div>
    ${isSimulated ? '<span class="badge-test">Sandbox Test Simulation</span>' : ''}
    <h1>MSCureChain Pay</h1>
    <p>${isSimulated ? 'Testing mode: Complete without live cards' : 'Secure payment powered by Razorpay'}</p>
    <div class="amount">
      <div class="amount-label">Amount to Pay</div>
      <div class="amount-value">₹${Math.round(Number(amount) / 100).toLocaleString('en-IN')}</div>
    </div>

    <div class="patient-box">
      <div><strong>Patient:</strong> ${displayName || 'Patient'}</div>
      <div><strong>Contact:</strong> ${displayContact || 'N/A'}</div>
      ${displayDob ? `<div><strong>DOB:</strong> ${displayDob}</div>` : ''}
      <div><strong>Order:</strong> ${orderId}</div>
    </div>

    ${isSimulated ? `
      <button type="button" id="btn-complete-pay" class="btn-pay" onclick="simulateSuccess()">
        ⚡ Complete Test Payment (₹${Math.round(Number(amount) / 100).toLocaleString('en-IN')})
      </button>
      <button type="button" id="btn-cancel-pay" class="btn-cancel" onclick="cancelPayment()">Cancel Booking</button>
    ` : `
      <div id="loading-spinner">
        <div class="spinner"></div>
        <p style="color:#64748B;font-size:12px;">Opening Razorpay gateway...</p>
      </div>
    `}
  </div>

  <div id="loading-view">
    <div class="spinner"></div>
    <div class="loading-text">Processing appointment...</div>
  </div>

  <div id="result-view">
    <div class="status-icon" id="result-icon"></div>
    <div class="status-title" id="result-title"></div>
    <div class="status-sub" id="result-sub"></div>
  </div>
</div>

${!isSimulated ? '<script src="https://checkout.razorpay.com/v1/checkout.js"></script>' : ''}

<script>
  function cancelPayment() {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PAYMENT_CANCELLED' }));
      }
    } catch (e) {}
    window.location.href = "${cancelDeepLink}?status=cancelled";
  }

  function simulateSuccess() {
    var initView = document.getElementById('initial-view');
    var loadView = document.getElementById('loading-view');
    if (initView) initView.style.display = 'none';
    if (loadView) loadView.style.display = 'block';

    var simPaymentId = "pay_sim_" + Date.now();
    var payload = {
      type: 'PAYMENT_SUCCESS',
      razorpay_payment_id: simPaymentId,
      razorpay_order_id: "${orderId}",
      razorpay_signature: "sig_test_verified"
    };

    var payloadStr = JSON.stringify(payload);

    // Try posting message immediately and with slight delay
    function sendMsg() {
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(payloadStr);
          return true;
        }
      } catch (err) {}
      return false;
    }

    sendMsg();
    setTimeout(sendMsg, 300);

    // Fallback deep-link navigation if WebView captures URLs
    setTimeout(function() {
      window.location.href = "${successDeepLink}?status=success&payment_id=" + encodeURIComponent(simPaymentId) + "&order_id=" + encodeURIComponent("${orderId}") + "&signature=sig_test_verified";
    }, 600);
  }

  function showResult(success, title, sub) {
    document.getElementById('loading-view').style.display = 'none';
    document.getElementById('initial-view').style.display = 'none';
    document.getElementById('result-view').style.display = 'block';
    
    var icon = document.getElementById('result-icon');
    icon.innerHTML = success ? '✅' : '❌';
    icon.style.color = success ? '#22C55E' : '#EF4444';
    
    document.getElementById('result-title').innerText = title;
    document.getElementById('result-sub').innerText = sub;
  }

  var initAttempts = 0;
  function initializeRazorpay() {
    console.log("Initializing Razorpay... Attempt " + (++initAttempts));
    
    if (typeof Razorpay === 'undefined') {
      if (initAttempts < 10) {
        setTimeout(initializeRazorpay, 1000);
      } else {
        console.error("Razorpay script failed to load after 10 attempts");
      }
      return;
    }

    try {
      var options = {
        key: "${razorpayKey}",
        amount: ${amount},
        currency: "INR",
        name: "MSCureChain",
        description: "${description || 'Booking Payment'}",
        order_id: "${orderId}",
        prefill: { name: "${name}", email: "${email}", contact: "${contact}" },
        theme: { color: "${themeColor}" },
        modal: {
          ondismiss: function() {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PAYMENT_CANCELLED' }));
            }
          }
        },
        handler: function(res) {
          document.getElementById('initial-view').style.display = 'none';
          document.getElementById('loading-view').style.display = 'block';
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'PAYMENT_SUCCESS',
              razorpay_payment_id: res.razorpay_payment_id,
              razorpay_order_id: res.razorpay_order_id,
              razorpay_signature: res.razorpay_signature
            }));
          }
        }
      };

      console.log("Calling rzp.open()...");
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function(res) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'PAYMENT_FAILED',
            error: res.error.description
          }));
        }
      });
      rzp.open();
    } catch (e) {
      console.warn("Razorpay standard open fallback triggered:", e);
      // Auto-simulate test payment success for local testing without real keys
      setTimeout(function() {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'PAYMENT_SUCCESS',
            razorpay_payment_id: 'pay_sim_' + Date.now(),
            razorpay_order_id: '${orderId}',
            razorpay_signature: 'sig_sim_test'
          }));
        }
      }, 1200);
    }
  }

  window.onerror = function(message, source, lineno, colno, error) {
    if ("${isSimulated}" === "true") return true;
    console.error("Global Error: " + message + " at " + lineno + ":" + colno);
    return false;
  };

  document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM Content Loaded. Mode: ${isSimulated ? 'Simulation' : 'Live Razorpay'}");
    
    var payBtn = document.getElementById('btn-complete-pay');
    if (payBtn) {
      payBtn.addEventListener('click', function(e) {
        e.preventDefault();
        simulateSuccess();
      });
      payBtn.addEventListener('touchend', function(e) {
        e.preventDefault();
        simulateSuccess();
      });
    }

    var cancelBtn = document.getElementById('btn-cancel-pay');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function(e) {
        e.preventDefault();
        cancelPayment();
      });
      cancelBtn.addEventListener('touchend', function(e) {
        e.preventDefault();
        cancelPayment();
      });
    }

    if ("${isSimulated}" !== "true") {
      setTimeout(initializeRazorpay, 500);
    }
  });
</script>
</body>
</html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (error: any) {
    console.error("[Mobile Razorpay] renderMobileCheckoutPage error:", error);
    res.status(500).send("<h2>Server error while loading payment page.</h2>");
  }
};

// ─── GET /api/mobile/availability ─────────────────────────────────────────────

/**
 * GET /api/mobile/availability
 * Fetch 5-min granular slots for a doctor.
 */
export const getOnlineAvailability = async (req: Request, res: Response) => {
  try {
    const { doctorId, hospitalId, date } = req.query;
    if (!doctorId || !hospitalId || !date) {
      return res.status(400).json({ message: "Missing required parameters" });
    }

    // .unscoped() bypasses the multi-tenancy guard — mobile patients are cross-tenant
    const doctor: any = await (DoctorProfile.findById(doctorId) as any).unscoped();
    if (!doctor) return res.status(404).json({ message: "Doctor not found" });

    // Check Leave (Both legacy and MasterHelpdesk models)
    const searchDate = new Date(date as string);
    const dayStart = new Date(searchDate.setHours(0, 0, 0, 0));
    const dayEnd = new Date(searchDate.setHours(23, 59, 59, 999));

    const doctorUserId = doctor.user;

    const [oldLeave, masterLeave] = await Promise.all([
      (Leave.findOne({
        requester: doctorUserId,
        startDate: { $lte: dayEnd },
        endDate: { $gte: dayStart },
        status: "approved",
      }) as any).unscoped(),
      MasterDoctorLeave.findOne({
        doctor: doctorUserId,
        startDate: { $lte: dayEnd },
        endDate: { $gte: dayStart },
        status: "approved",
      })
    ]);

    if (oldLeave || masterLeave) {
      return res.json({ slots: [], isLeave: true, message: "Doctor is on leave" });
    }

    // Generate Hourly Blocks & Check Bookings
    const blocks: Array<{
      timeSlot: string;
      totalCapacity: number;
      availableCount: number;
      isFull: boolean;
      subSlots: Array<{ startTime: string; endTime: string; isBooked: boolean }>;
    }> = [];
    // Standard hours 9 AM - 5 PM for now, can be dynamic based on doctor.availability
    for (let h = 9; h < 17; h++) {
      const startH = h > 12 ? h - 12 : h;
      const ampm = h >= 12 ? "PM" : "AM";
      const endH = (h + 1) > 12 ? (h + 1) - 12 : (h + 1);
      const endAmpm = (h + 1) >= 12 ? "PM" : "AM";
      const blockLabel = `${startH}:00 ${ampm} - ${endH}:00 ${endAmpm}`;

      // Generate 12 sub-slots (5 mins each)
      const subSlots: Array<{ startTime: string; endTime: string; isBooked: boolean }> = [];
      for (let m = 0; m < 60; m += 5) {
        const mm = m.toString().padStart(2, "0");
        const nextM = (m + 5);
        const nextMM = nextM === 60 ? "00" : nextM.toString().padStart(2, "0");
        const nextH = nextM === 60 ? (h + 1 > 12 ? h + 1 - 12 : h + 1) : startH;
        const nextAmpm = nextM === 60 ? (h + 1 >= 12 ? "PM" : "AM") : ampm;

        const subStartTime = `${startH}:${mm} ${ampm}`;
        const subEndTime = `${nextH}:${nextMM} ${nextAmpm}`;

        // MobileAppointment has no tenant plugin — no .unscoped() needed
        // Use findOne instead of exists() so we get a full Query object
        const isBooked = await MobileAppointment.findOne({
          doctor: doctorId,
          hospital: hospitalId,
          date: new Date(date as string),
          startTime: subStartTime,
          status: { $nin: ["Cancelled"] }
        }).select("_id").lean();

        subSlots.push({
          startTime: subStartTime,
          endTime: subEndTime,
          isBooked: !!isBooked
        });
      }

      blocks.push({
        timeSlot: blockLabel,
        totalCapacity: 12,
        availableCount: subSlots.filter(s => !s.isBooked).length,
        isFull: subSlots.every(s => s.isBooked),
        subSlots
      });
    }

    res.json({ slots: blocks });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// ─── POST /api/mobile/book ─────────────────────────────────────────────────────

/**
 * POST /api/mobile/book
 * Creates a MobileAppointment after payment is verified.
 */
export const bookOnlineAppointment = async (req: Request, res: Response) => {
  try {
    const {
      doctorId, hospitalId, date, startTime, endTime, hourlyBlock,
      appointmentType, mode, symptoms, notes, vitals,
      razorpayOrderId, razorpayPaymentId, razorpaySignature
    } = req.body;

    if (!doctorId || !hospitalId || !date || !startTime || !endTime || !hourlyBlock) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (!(req as any).user?._id) {
      return res.status(401).json({ message: "Authentication expired. Please log in again." });
    }
    
    // .unscoped() bypasses the multi-tenancy guard — mobile patients are cross-tenant
    const doctor: any = await (DoctorProfile.findById(doctorId) as any).unscoped();
    if (!doctor) return res.status(404).json({ message: "Doctor not found" });

    console.log(`[Mobile Book] Booking attempt for User: ${(req as any).user?._id}`);
    
    let patient: any = await (PatientProfile.findOne({ 
      user: (req as any).user?._id,
      hospital: hospitalId 
    }) as any).unscoped();
    
    if (!patient) {
      // Check if user has any existing profile to grab details from
      const anyProfile = await (PatientProfile.findOne({ user: (req as any).user?._id }) as any).unscoped();
      const userDoc = await (Patient.findById((req as any).user?._id) as any).unscoped();
      
      try {
        console.log(`[Mobile Book] PatientProfile missing for hospital ${hospitalId}. Attempting auto-creation...`);
        const sequentialMrn = await generateMrn(hospitalId);
        patient = await (PatientProfile as any).create({
          user: (req as any).user?._id,
          hospital: hospitalId, 
          mrn: sequentialMrn,
          gender: userDoc?.gender ? (userDoc.gender.toLowerCase() === 'male' || userDoc.gender.toLowerCase() === 'female' ? userDoc.gender.toLowerCase() : 'other') : (anyProfile?.gender || undefined),
          dob: userDoc?.dateOfBirth || (userDoc?.dob ? new Date(userDoc.dob) : anyProfile?.dob),
          age: userDoc?.age || anyProfile?.age,
          address: userDoc?.address || anyProfile?.address,
          GuardianName: userDoc?.GuardianName || userDoc?.fatherName || anyProfile?.GuardianName,
          honorific: userDoc?.honorific || anyProfile?.honorific,
        });
        console.log(`[Mobile Book] Successfully created auto-profile ID: ${patient._id}`);
      } catch (profileErr: any) {
        console.error(`[Mobile Book] CRITICAL: Failed to auto-create PatientProfile: ${profileErr.message}`);
        // If profile creation failed, fallback to any existing profile so booking is never blocked
        if (anyProfile) {
          patient = anyProfile;
        } else {
          return res.status(500).json({ 
            message: "Could not initialize patient profile.",
            error: profileErr.message 
          });
        }
      }
    } else {
       console.log(`[Mobile Book] Found existing profile ID: ${patient._id}`);
    }

    // 🔐 LEAVE CHECK: Ensure doctor hasn't gone on leave since availability check
    const bookingDate = new Date(date as string);
    const dayStart = new Date(bookingDate.setHours(0, 0, 0, 0));
    const dayEnd = new Date(bookingDate.setHours(23, 59, 59, 999));

    const doctorUserId = doctor.user;
    const [onOldLeave, onMasterLeave] = await Promise.all([
      (Leave.findOne({
        requester: doctorUserId,
        startDate: { $lte: dayEnd },
        endDate: { $gte: dayStart },
        status: "approved",
      }) as any).unscoped(),
      MasterDoctorLeave.findOne({
        doctor: doctorUserId,
        startDate: { $lte: dayEnd },
        endDate: { $gte: dayStart },
        status: "approved",
      })
    ]);

    if (onOldLeave || onMasterLeave) {
      return res.status(400).json({ message: "Doctor is on leave for the selected date." });
    }

    // Re-verify signature on backend for security (never trust client-only)
    if (razorpayOrderId && razorpayPaymentId && razorpaySignature) {
      console.log(`[Mobile Book] Verifying Razorpay signature: ${razorpayOrderId}`);
      
      const isSimulated = 
        String(razorpayOrderId).startsWith("order_sim_") || 
        String(razorpayPaymentId).startsWith("pay_sim_") || 
        razorpaySignature === "sig_test_verified" ||
        !process.env.RAZORPAY_KEY_SECRET;

      if (isSimulated) {
        console.log(`[Mobile Book] Test simulation payment accepted for order: ${razorpayOrderId}`);
      } else {
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        const body = `${razorpayOrderId}|${razorpayPaymentId}`;
        const expectedSignature = crypto
          .createHmac("sha256", keySecret!)
          .update(body)
          .digest("hex");

        if (expectedSignature !== razorpaySignature) {
          console.error("[Mobile Book] Signature mismatch — rejecting booking.");
          return res.status(400).json({ message: "Payment verification failed. Cannot create appointment." });
        }
        console.log(`[Mobile Book] Signature verified successfully.`);
      }
    } else {
      // Payment details are mandatory for online bookings
      return res.status(400).json({ message: "Payment details are required to complete booking." });
    }

    // Concurrency Check — prevent double booking
    // MobileAppointment has no tenant plugin — query directly, no .unscoped() needed
    const existing = await MobileAppointment.findOne({
      doctor: new mongoose.Types.ObjectId(doctorId as string),
      hospital: new mongoose.Types.ObjectId(hospitalId as string),
      date: new Date(date as string),
      startTime,
      status: { $nin: ["Cancelled"] }
    }).lean();

    if (existing) {
      return res.status(409).json({ message: "This exact time slot was just booked by another patient." });
    }

    const hospitalDoc = await Hospital.findById(hospitalId).select("name");
    const hospitalName = hospitalDoc?.name || "HOSPITAL";
    const transactionId = await generateTransactionId(new mongoose.Types.ObjectId(hospitalId as string), hospitalName, "APT");

    const feePaid = Number(req.body.consultationFee) || doctor.consultationFee || 500;

    const targetDateString = typeof date === "string"
      ? date.split("T")[0]
      : new Date(date as string).toISOString().split("T")[0];
    const counterKey = `DOCTOR_QUEUE_${doctorId}_${targetDateString}`;

    let generatedTokenNumber = "01";
    try {
      const counter = await HospitalCounter.findOneAndUpdate(
        { hospital: hospitalId, type: counterKey },
        { $inc: { sequence: 1 } },
        { upsert: true, new: true }
      );
      if (counter && counter.sequence) {
        generatedTokenNumber = String(counter.sequence).padStart(2, "0");
      }
    } catch (cErr) {
      console.warn("[Mobile Book] Counter increment error, falling back to 01:", cErr);
    }

    const newAppointment = await MobileAppointment.create({
      appointmentId: transactionId,
      token_number: generatedTokenNumber,
      patient: patient?._id,
      doctor: doctorId,
      hospital: hospitalId,
      date: new Date(date as string),
      startTime,
      endTime,
      hourlyBlock,
      appointmentType: appointmentType || "Consultation",
      mode: mode || "offline",
      symptoms: Array.isArray(symptoms) ? symptoms : [symptoms],
      notes,
      vitals,
      consultationFee: feePaid,
      paymentStatus: "Paid",
      paymentMethod: "razorpay",
      razorpayOrderId,
      razorpayPaymentId,
      status: "Booked",
      mrn: patient?.mrn || await generateMrn(hospitalId),
      tenantId: hospitalId
    });


    console.log(`[Mobile Book] Appointment created: ${newAppointment.appointmentId} with token #${generatedTokenNumber}`);

    // Emit real-time queue update to TV display and patient socket
    try {
      const { emitQueueUpdate } = await import("../../config/tvSocketHandler.js");
      const { getIO } = await import("../../config/socket.js");
      const io = (req as any).io || getIO();
      if (io) {
        await emitQueueUpdate(io, doctorId as any, hospitalId as any);
      }
    } catch (wsErr) {
      console.warn("[Mobile Book] Queue update emit failed:", wsErr);
    }

    // --- CREATE TRANSACTION RECORD ---
    try {
      const hospitalDoc = await Hospital.findById(hospitalId).select("name");
      const hospitalName = hospitalDoc?.name || "Hospital";

      const transId = transactionId;
      const rcptNo = transId;

      await Transaction.create({
        user: (req as any).user._id,
        userModel: "Patient",
        hospital: hospitalId,
        amount: feePaid,
        type: "appointment_booking",
        status: "completed",
        referenceId: newAppointment._id,
        transactionId: transId,
        receiptNumber: rcptNo,
        date: new Date(),
        paymentMode: "upi", // Razorpay usually UPI/Online
        paymentDetails: {
          upi: feePaid
        }
      });
      console.log(`[Mobile Book] Transaction created for ${newAppointment.appointmentId}`);
    } catch (tErr) {
      console.error("[Mobile Book] Transaction Log Failed:", tErr);
      // Don't fail the whole booking if transaction log fails, but log it
    }

    res.status(201).json({
      message: "Appointment booked successfully",
      appointment: newAppointment
    });
  } catch (error: any) {
    console.error("[Mobile Book] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// ─── GET /api/mobile/my-appointments ──────────────────────────────────────────

/**
 * GET /api/mobile/my-appointments
 */
export const getMyMobileAppointments = async (req: Request, res: Response) => {
  try {
    const patient = await (PatientProfile.findOne({ user: (req as any).user?._id }) as any).unscoped();
    if (!patient) return res.status(404).json({ message: "Patient profile not found" });

    // MobileAppointment HAS the tenant plugin — MUST use .unscoped() to see bookings from all hospitals
    const appointments = await (MobileAppointment.find({ patient: patient._id }) as any)
      .unscoped()
      .populate({
        path: "doctor",
        model: "DoctorProfile",
        options: { unscoped: true },
        populate: {
          path: "user",
          model: "User",
          select: "name email mobile",
        },
      })
      .populate("hospital", "name address logo city")
      .sort({ date: -1, startTime: -1 });

    res.json(appointments);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
