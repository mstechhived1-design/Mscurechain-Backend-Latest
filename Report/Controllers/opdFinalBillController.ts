import { Request, Response } from "express";
import mongoose from "mongoose";
import Appointment from "../../Appointment/Models/Appointment.js";
import PharmacyOrder from "../../Pharmacy/Models/PharmacyOrder.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import Patient from "../../Patient/Models/Patient.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Transaction from "../../Admin/Models/Transaction.js";
import "../../Pharmacy/Models/Invoice.js";

export const getOPDFinalBill = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;
    const hospitalId = (req as any).hospitalId;
    console.log(`[getOPDFinalBill] HIT for patientId=${patientId}, hospitalId=${hospitalId}`);

    const pId = new mongoose.Types.ObjectId(patientId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Fetch Patient + Profile details
    const patient = await Patient.findById(pId).select("name mobile email").lean();
    if (!patient) {
      return res.status(404).json({ message: "Patient not found." });
    }
    const patientProfile = await PatientProfile.findOne({ $or: [{ user: pId }, { patient: pId }], hospital: hospitalId }).lean();

    // Fetch Hospital details
    const hospital = await Hospital.findById(hospitalId).select("name address phone email logo gstNumber").lean();

    // Find latest appointment to get doctor reference / guardian info if needed
    const latestApt = await Appointment.findOne({
      $or: [{ patient: pId }, { globalPatientId: pId }],
      hospital: hospitalId,
    }).sort({ date: -1, createdAt: -1 }).lean();

    const resolvedDoctorReference = 
      (patientProfile as any)?.doctorReference || 
      (patientProfile as any)?.referredBy || 
      latestApt?.doctorReference || 
      latestApt?.patientDetails?.doctorReference || 
      (patient as any)?.doctorReference || 
      (patient as any)?.referredBy || 
      "";

    // Build patient info header
    const patientInfo = {
      name: (patient as any)?.name || "Unknown",
      mobile: (patient as any)?.mobile || (patientProfile as any)?.contactNumber || "N/A",
      mrn: (patientProfile as any)?.mrn || "N/A",
      age: (patientProfile as any)?.age || "",
      gender: (patientProfile as any)?.gender || "",
      address: (patientProfile as any)?.address || "",
      dob: (patientProfile as any)?.dob || null,
      guardianName: (patientProfile as any)?.GuardianName || latestApt?.guardianName || "",
      guardianRelation: (patientProfile as any)?.GuardianRelation || latestApt?.guardianRelation || "",
      doctorReference: resolvedDoctorReference,
      referredBy: resolvedDoctorReference,
    };

    const hospitalInfo = {
      name: (hospital as any)?.name || "Hospital",
      address: (hospital as any)?.address || "",
      phone: (hospital as any)?.phone || "",
      email: (hospital as any)?.email || "",
      logo: (hospital as any)?.logo || "",
      gstNumber: (hospital as any)?.gstNumber || "",
    };

    const reportData: any = {
      doctors: [],     
      admissions: [],  
      diags: [],       
      services: [],    
      rads: [],        
      meds: [],        
      payments: [],
      doctorReference: resolvedDoctorReference,
      referredBy: resolvedDoctorReference,
    };

    let grandTotal = 0;
    let totalPaid = 0;
    
    // 1. Consultations — only the LATEST OPD appointment
    const latestOnly = req.query.latestOnly === 'true';
    let appointmentQuery = Appointment.find({
      $or: [{ patient: pId }, { globalPatientId: pId }],
      hospital: hospitalId,
      isIPD: { $ne: true }
    }).populate({ path: "doctor", populate: { path: "user", select: "name" } }).sort({ date: -1, createdAt: -1 });

    if (latestOnly) {
      appointmentQuery = appointmentQuery.limit(1);
    }

    const appointments = await appointmentQuery.lean();

    for (const apt of appointments) {
      const amount = apt.amount || apt.payment?.amount || 0;
      reportData.doctors.push({
        code: `APT${apt._id.toString().substring(18).toUpperCase()}`,
        doctorName: (apt.doctor as any)?.user?.name || "Doctor",
        specialization: (apt.doctor as any)?.specialization || "Consultation",
        rate: amount,
        visits: 1,
        amount: amount,
      });
      grandTotal += amount;
    }

    // 2. Pharmacy Orders & Invoices
    const pharmacyOrders = await PharmacyOrder.find({
      $or: [{ patient: pId }, { globalPatientId: pId }],
      hospital: hospitalId,
      createdAt: { $gte: today, $lt: tomorrow },
      $and: [
        { $or: [{ admission: null }, { admission: { $exists: false } }] }
      ],
      isDeleted: false
    }).lean();

    // Find actual PharmaInvoices generated for this patient to extract exact prices
    const patientNameStr = patientInfo.name.toString().trim();
    const patientMobileStr = patientInfo.mobile.toString().trim();
    
    const pharmaInvoices = await mongoose.model("PharmaInvoice").find({
      hospital: hospitalId,
      status: { $ne: "RETURN" },
      $or: [
        { patientName: new RegExp(`^${patientNameStr}$`, 'i') },
        { customerPhone: patientMobileStr }
      ]
    }).lean();
    
    // Create a price lookup map from invoices
    const invoicePriceMap = new Map();
    if (pharmaInvoices && pharmaInvoices.length > 0) {
      for (const inv of pharmaInvoices) {
        for (const item of (inv.items || [])) {
          if (item.productName) {
            // Store the exact amount and qty so we can calculate unit rate
            invoicePriceMap.set(item.productName.toLowerCase().trim(), {
              rate: item.unitRate || 0,
              amount: item.amount || 0,
              qty: item.qty || 1,
              invoiceId: inv._id
            });
          }
        }
      }
    }
    
    const matchedInvoiceIds = new Set();

    // Process Pharmacy Orders as the source of truth to avoid pulling walk-in items
    for (const order of pharmacyOrders) {
      const suffix = order._id.toString().substring(18).toUpperCase();
      if (order.medicines && order.medicines.length > 0) {
        const avgPrice = order.totalAmount ? (order.totalAmount / order.medicines.length) : 0;
        
        for (let i = 0; i < order.medicines.length; i++) {
          const m = order.medicines[i];
          const qty = Number(m.quantity) || 1;
          const nameLower = (m.name || "").toLowerCase().trim();
          
          let rate = m.price;
          let mAmount = rate * qty;
          
          // Check if we have exact pricing from the invoice
          let exactMatch = false;
          for (const [invName, invData] of invoicePriceMap.entries()) {
            if (nameLower.includes(invName) || invName.includes(nameLower)) {
              rate = invData.rate;
              // If quantities match, use exact amount, else calculate
              mAmount = (qty === invData.qty) ? invData.amount : (rate * qty);
              exactMatch = true;
              matchedInvoiceIds.add(invData.invoiceId);
              break;
            }
          }
          
          if (!exactMatch && !m.price) {
            mAmount = avgPrice;
            rate = avgPrice / qty;
          }
          
          reportData.meds.push({
            code: `MED${suffix}_${i + 1}`,
            medicineName: m.name || "Medicine",
            rate: rate || 0,
            quantity: qty,
            amount: mAmount || 0,
          });
          grandTotal += (mAmount || 0);
        }
      } else {
        reportData.meds.push({
          code: `MED${suffix}`,
          medicineName: "Pharmacy Items",
          rate: order.totalAmount || 0,
          quantity: 1,
          amount: order.totalAmount || 0,
        });
        grandTotal += (order.totalAmount || 0);
      }
    }

    // 3. Lab Orders
    const labOrders = await LabOrder.find({
      $or: [{ patient: pId }, { globalPatientId: pId }],
      hospital: hospitalId,
      createdAt: { $gte: today, $lt: tomorrow },
      $and: [
        { $or: [{ admission: null }, { admission: { $exists: false } }] }
      ]
    }).populate("tests.test").lean();

    for (const order of labOrders) {
      const suffix = order._id.toString().substring(18).toUpperCase();
      
      // Filter out empty/dummy tests and tests that were deleted or not found (must be fully populated with _id)
      const validTests = (order.tests || []).filter((t: any) => {
        // A properly populated document will have _id. 
        // An unpopulated ObjectId won't have _id (it IS the id).
        const isPopulated = t.test && typeof t.test === 'object' && ('_id' in t.test || 'name' in t.test || 'testName' in t.test);
        return isPopulated || (t.testName && t.testName !== "Lab Test");
      });
      
      if (validTests.length > 0) {
        const avgCost = order.totalAmount ? (order.totalAmount / validTests.length) : 0;
        
        for (let i = 0; i < validTests.length; i++) {
          const t: any = validTests[i];
          const rate = t.cost || avgCost;
          const rawTestName = t.test?.testName || t.test?.name || t.testName || "Lab Test";
          const actualTestName = typeof rawTestName === 'object'
            ? (rawTestName.testName || rawTestName.name || "Lab Test")
            : (String(rawTestName).trim() === '[object Object]' ? 'Lab Test' : String(rawTestName).trim());

          reportData.diags.push({
            code: `LAB${suffix}_${i + 1}`,
            testName: actualTestName || "Lab Test",
            rate: rate,
            quantity: 1,
            amount: rate,
          });
          grandTotal += rate;
        }
      } else {
        reportData.diags.push({
          code: `LAB${suffix}`,
          testName: "Diagnostics",
          rate: order.totalAmount || 0,
          quantity: 1,
          amount: order.totalAmount || 0,
        });
        grandTotal += (order.totalAmount || 0);
      }
    }

    const allRefIds = [
      ...appointments.map(a => a._id),
      ...pharmacyOrders.map(p => p._id),
      ...labOrders.map(l => l._id),
      ...Array.from(matchedInvoiceIds)
    ];

    // 4. Other OPD Transactions (e.g. Services, Packages)
    const serviceCriteria: any = {
      hospital: hospitalId,
      status: "completed",
      type: { $nin: ["appointment_booking", "pharmacy", "lab_test", "ipd_advance", "ipd_settlement", "ipd_refund"] }
    };
    if (latestOnly) {
      serviceCriteria.referenceId = { $in: allRefIds };
    } else {
      serviceCriteria.$or = [
        { user: pId, createdAt: { $gte: today, $lt: tomorrow } }, 
        { referenceId: { $in: allRefIds } }
      ];
    }
    const otherTransactions = await Transaction.find(serviceCriteria).lean();

    for (const txn of otherTransactions) {
      reportData.services.push({
        code: `SVC${txn._id.toString().substring(18).toUpperCase()}`,
        serviceName: txn.type || "Service",
        rate: txn.amount || 0,
        quantity: 1,
        amount: txn.amount || 0,
      });
      grandTotal += (txn.amount || 0);
    }

    // 5. Payments (Receipts)
    const paymentCriteria: any = {
      hospital: hospitalId,
      type: { $nin: ["ipd_advance", "ipd_settlement", "ipd_refund"] }
    };
    if (latestOnly) {
      paymentCriteria.$or = [
        { referenceId: { $in: allRefIds } },
        ...(appointments.length > 0 ? [{ referenceId: appointments[0]._id }] : [])
      ];
    } else {
      paymentCriteria.$or = [
        { user: pId, createdAt: { $gte: today, $lt: tomorrow } }, 
        { referenceId: { $in: allRefIds } }
      ];
    }
    const payments = await Transaction.find(paymentCriteria).lean();

    for (const payment of payments) {
      let mappedStatus = payment.status ? (payment.status.toLowerCase() === 'completed' ? 'Paid' : payment.status.charAt(0).toUpperCase() + payment.status.slice(1)) : undefined;
      
      // Appointments are typically paid upfront, even if marked pending in the DB
      if (payment.type === 'appointment_booking' && payment.status === 'pending') {
         mappedStatus = 'Paid';
      }

      reportData.payments.push({
        date: new Date(payment.date || payment.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
        receiptNo: payment.receiptNumber || payment.transactionId || payment._id.toString().slice(-6),
        receiptNumber: payment.receiptNumber || payment.transactionId || payment._id.toString().slice(-6),
        amount: payment.amount || 0,
        type: payment.type,
        mode: payment.paymentMode ? (payment.paymentMode.toLowerCase() === 'upi' ? 'UPI' : payment.paymentMode.charAt(0).toUpperCase() + payment.paymentMode.slice(1)) : undefined,
        paymentMode: payment.paymentMode ? (payment.paymentMode.toLowerCase() === 'upi' ? 'UPI' : payment.paymentMode.charAt(0).toUpperCase() + payment.paymentMode.slice(1)) : undefined,
        status: mappedStatus
      });
      if (mappedStatus === "Paid") {
        totalPaid += (payment.amount || 0);
      }
    }

    const subtotals = {
      consultation: reportData.doctors.reduce((s: number, i: any) => s + (i.amount || 0), 0),
      ward: 0,
      investigation: reportData.diags.reduce((s: number, i: any) => s + (i.amount || 0), 0),
      services: reportData.services.reduce((s: number, i: any) => s + (i.amount || 0), 0),
      radiology: reportData.rads.reduce((s: number, i: any) => s + (i.amount || 0), 0),
      pharmacy: reportData.meds.reduce((s: number, i: any) => s + (i.amount || 0), 0),
    };

    const balance = grandTotal - totalPaid;

    const admissionInfo = {
      admissionType: "OPD Patient",
      doctorName: reportData.doctors[0]?.doctorName || "N/A",
      doctorReference: resolvedDoctorReference,
      referredBy: resolvedDoctorReference,
    };

    const finalBill = {
      _id: `AUTO_OPD_BILL_${patientId}`,
      patient: patientId,
      hospital: hospitalId,
      patientInfo,
      hospitalInfo,
      admissionInfo,
      reportData,
      subtotals,
      totals: {
        grandTotal,
        returnCredits: 0,
        discount: 0,
        netAmount: grandTotal,
        totalPaid,
        balance,
      },
      doctorReference: resolvedDoctorReference,
      referredBy: resolvedDoctorReference,
      receipts: reportData.payments,
      generatedBy: "System (Auto-Generated)",
      date: new Date(),
      isAutoGenerated: true,
      isOPD: true,
    };

    res.json([finalBill]);
  } catch (error: any) {
    console.error("Error generating OPD final bill:", error);
    res.status(500).json({ message: error.message || "Failed to generate final bill." });
  }
};
