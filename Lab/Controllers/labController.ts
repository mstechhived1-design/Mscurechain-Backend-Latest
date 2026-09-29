import { Request, Response } from "express";
import mongoose from "mongoose";
import LabOrder from "../Models/LabOrder.js";
import DirectLabOrder from "../Models/DirectLabOrder.js";
import LabTest from "../Models/LabTest.js";
import Department from "../Models/Department.js";
import UniversalLabTest from "../Models/UniversalLabTest.js";
import UniversalTestParameter from "../Models/UniversalTestParameter.js";
import LabOrderStatusHistory from "../Models/LabOrderStatusHistory.js";
import HospitalLabConfig from "../Models/HospitalLabConfig.js";
import LabPackage from "../Models/LabPackage.js";
import LabToken from "../Models/LabToken.js";
import TestGroup from "../Models/TestGroup.js";
import TestParameter from "../Models/TestParameter.js";
import User from "../../Auth/Models/User.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Transaction from "../../Admin/Models/Transaction.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import IPDExtraCharge from "../../IPD/Models/IPDExtraCharge.js";
import Patient from "../../Patient/Models/Patient.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import { AuthRequest } from "../../Auth/types/index.js";
import labService from "../../services/lab.service.js";
import redisService from "../../config/redis.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import Bed from "../../IPD/Models/Bed.js";

// 1. Create Order (Step 2: Patient comes to Lab)
export const createLabOrder = async (req: Request, res: Response) => {
  const {
    prescriptionId,
    patientId,
    patientDetails,
    items,
    subtotal,
    discountAmount,
    discountReason,
    totalAmount,
    finalAmount,
    paymentMode,
    admissionId,
    paymentDetails: mixedDetails,
    paidAmount,
    balance,
    referredBy,
  } = req.body;
  const actualAmount = finalAmount || totalAmount;
  let currentHospital = (req as any).tenantId;

  let order: any = null;

  try {
    if (prescriptionId) {
      const prescription: any =
        await Prescription.findById(prescriptionId).populate("doctor patient");
      if (!prescription)
        return res.status(404).json({ message: "Prescription not found" });

      // If for some reason tenantId wasn't in req (e.g. global route), use prescription's hospital
      if (!currentHospital && prescription.hospital) {
        currentHospital = prescription.hospital;
      }

      const testNames = prescription.suggestedTests || [];
      const labTests = await LabTest.find({
        $or: [{ testName: { $in: testNames } }, { name: { $in: testNames } }],
        hospital: currentHospital, // Enforce hospital isolation
      });

      const tests = labTests.map((test) => ({
        test: test._id,
        testName: test.testName || test.name,
        status: "pending",
        cost: Number((test as any).price || (test as any).cost || 0),
      }));

      const calcTotal = labTests.reduce((sum, test: any) => {
        return sum + (test.price || 0);
      }, 0);

      let admissionObjectId: any = prescription.admission || null;
      if (admissionId) {
        const admissionRecord = await IPDAdmission.findOne({
          $or: [
            { admissionId: admissionId },
            {
              _id: mongoose.Types.ObjectId.isValid(admissionId)
                ? admissionId
                : undefined,
            },
          ],
        });
        if (admissionRecord) admissionObjectId = admissionRecord._id;
      }

      order = await LabOrder.create({
        patient: prescription.patient?._id || prescription.patient,
        globalPatientId: prescription.patient?._id || prescription.patient,
        doctor: prescription.doctor?._id || prescription.doctor,
        referredBy: (req as any).user?._id, // Capture who initiated this
        prescription: prescription._id,
        admission: admissionObjectId,
        tests: tests as any,
        status: "prescribed",
        totalAmount: calcTotal || actualAmount,
        paymentStatus: "paid",
        hospital: currentHospital,
      });
    } else if ((patientId || patientDetails) && items) {
      let resolvedPatientId = patientId;
      let existingUser;
      
      // If we got an exact patientId from Front Desk, look them up
      if (resolvedPatientId) {
        existingUser = await Patient.findById(resolvedPatientId);
      } 
      // Otherwise fallback to mobile & name search
      else if (patientDetails) {
        existingUser = await Patient.findOne({
          mobile: patientDetails.mobile,
          name: { $regex: new RegExp("^" + patientDetails.name + "$", "i") },
        });
      }

      if (existingUser) {
        resolvedPatientId = existingUser._id;
        if (patientDetails) {
            if (patientDetails.age !== undefined) {
              const parsedAge = Number(patientDetails.age);
              if (!isNaN(parsedAge)) existingUser.age = parsedAge;
            }
            if (patientDetails.ageUnit)
              existingUser.ageUnit = patientDetails.ageUnit;
            if (patientDetails.gender) {
              const normalizedGender = ["male", "female", "other"].includes(patientDetails.gender.toLowerCase())
                ? patientDetails.gender.toLowerCase()
                : undefined;
              if (normalizedGender) existingUser.gender = normalizedGender;
            }
    
            if (patientDetails.email && !existingUser.email)
              existingUser.email = patientDetails.email;
        }

        // Update role to patient if not already
        if (existingUser.role !== "patient") {
          existingUser.role = "patient";
        }

        // Update hospitals array
        if (!existingUser.hospitals) {
          existingUser.hospitals = [];
        }
        const legacyHospital = (existingUser as any).hospital;
        if (legacyHospital) {
          if (
            !existingUser.hospitals.some(
              (h: any) => h.toString() === legacyHospital.toString(),
            )
          ) {
            existingUser.hospitals.push(legacyHospital);
          }
          await Patient.collection.updateOne(
            { _id: existingUser._id },
            { $unset: { hospital: "" } },
          );
        }
        if (
          currentHospital &&
          !existingUser.hospitals.some(
            (h: any) => h.toString() === currentHospital.toString(),
          )
        ) {
          existingUser.hospitals.push(currentHospital);
        }

        await existingUser.save();
      } else {
        // Try to create new user, handle duplicate key error
        try {
          const newUser = await Patient.create({
            name: patientDetails.name,
            mobile: patientDetails.mobile,
            email: patientDetails.email,
            age: (patientDetails.age !== undefined && !isNaN(Number(patientDetails.age))) ? Number(patientDetails.age) : undefined,
            ageUnit: patientDetails.ageUnit || "Years",
            gender: (patientDetails.gender && ["male", "female", "other"].includes(patientDetails.gender.toLowerCase()))
              ? patientDetails.gender.toLowerCase()
              : undefined,
            role: "patient",
            hospitals: currentHospital ? [currentHospital] : [],
            password: Math.random().toString(36).slice(-8),
          });
          resolvedPatientId = newUser._id;
        } catch (createError: any) {
          // Handle duplicate key error (race condition)
          if (createError.code === 11000) {
            // User was created between our check and create - fetch it
            const retryUser = await Patient.findOne({
              mobile: patientDetails.mobile,
            });
            if (retryUser) {
              resolvedPatientId = retryUser._id;
              // Update details
              if (patientDetails.age !== undefined) {
                const parsedAge = Number(patientDetails.age);
                if (!isNaN(parsedAge)) retryUser.age = parsedAge;
              }
              if (patientDetails.ageUnit)
                retryUser.ageUnit = patientDetails.ageUnit;
              if (patientDetails.gender) {
                const normalizedGender = ["male", "female", "other"].includes(patientDetails.gender.toLowerCase())
                  ? patientDetails.gender.toLowerCase()
                  : undefined;
                if (normalizedGender) retryUser.gender = normalizedGender;
              }
              await retryUser.save();
            } else {
              throw createError; // Re-throw if still can't find
            }
          } else {
            throw createError; // Re-throw non-duplicate errors
          }
        }
      }

      // Ensure PatientProfile exists for this hospital context
      if (resolvedPatientId && currentHospital) {
        const existingProfile = await PatientProfile.findOne({
          user: resolvedPatientId,
          hospital: currentHospital,
        });
        if (!existingProfile) {
          await PatientProfile.create({
            user: resolvedPatientId,
            hospital: currentHospital,
            gender: (patientDetails?.gender && ["male", "female", "other"].includes(patientDetails.gender.toLowerCase()))
              ? patientDetails.gender.toLowerCase()
              : undefined,
          });
        }
      }

      // Mixed Payment Validation
      if (paymentMode?.toLowerCase() === "mixed") {
        if (!mixedDetails)
          return res
            .status(400)
            .json({ message: "Payment details required for mixed mode" });
        const totalMixed =
          (mixedDetails.cash || 0) +
          (mixedDetails.card || 0) +
          (mixedDetails.upi || 0);
        if (Math.abs(totalMixed - actualAmount) > 2) {
          return res.status(400).json({
            message: `Mixed payments (₹${totalMixed}) do not match total (₹${actualAmount})`,
          });
        }
      }

      const labTests = await LabTest.find({
        $or: [
          { testName: { $in: items.map((i: any) => i.testName) } },
          { name: { $in: items.map((i: any) => i.testName) } },
        ],
        hospital: currentHospital, // Enforce hospital isolation
      });

      // Phase 11: Test Packages Expansion
      const labPackages = await LabPackage.find({
        name: { $in: items.map((i: any) => i.testName) },
        hospital: currentHospital,
      }).populate("tests");

      let finalTestItems: any[] = [];
      
      for (const i of items) {
        // Is it a package?
        const pkg = labPackages.find(p => p.name === i.testName);
        if (pkg && pkg.tests) {
          pkg.tests.forEach((pkgTest: any) => {
            finalTestItems.push({
              test: pkgTest._id,
              testName: pkgTest.testName || pkgTest.name,
              status: "pending",
              cost: Number(pkgTest.price || pkgTest.cost || 0),
            });
          });
        } else {
          // Is it a standalone test?
          let found = labTests.find(
            (lt) => lt.name === i.testName || lt.testName === i.testName,
          );
          
          if (!found) {
            // Dynamically create the custom test so it's not dropped
            try {
              found = await LabTest.create({
                hospital: currentHospital,
                testName: i.testName,
                name: i.testName,
                price: Number(i.amount || 0),
                category: i.category || 'Custom',
                isActive: true,
                testCode: `TC-${Date.now()}-${Math.floor(Math.random() * 1000)}`
              });
              labTests.push(found);
            } catch (err) {
              console.error("Failed to dynamically create custom LabTest:", err);
            }
          }

          finalTestItems.push({
            test: found ? found._id : undefined,
            testName: i.testName || (found && (found.testName || found.name)),
            status: "pending",
            cost: Number(i.amount || i.price || i.cost || (found as any)?.cost || found?.price || 0),
          });
        }
      }
      
      const tests = finalTestItems;

      let admissionObjectId: any = null;
      if (admissionId) {
        const admissionRecord = await IPDAdmission.findOne({
          $or: [
            { admissionId: admissionId },
            {
              _id: mongoose.Types.ObjectId.isValid(admissionId)
                ? admissionId
                : undefined,
            },
          ],
        });
        if (admissionRecord) admissionObjectId = admissionRecord._id;
      }

      if (!admissionObjectId) {
        const profile = await PatientProfile.findOne({ user: patientId });
        const activeAdmission = await IPDAdmission.findOne({
          $or: [{ patient: patientId }, { patient: profile?._id }],
          status: "Active",
        });
        if (activeAdmission) admissionObjectId = activeAdmission._id;
      }

      order = await LabOrder.create({
        patient: resolvedPatientId,
        globalPatientId: resolvedPatientId,
        doctor: null, // Self-ordered / Walk-in has no doctor initially
        referredBy: referredBy || (req as any).user?._id, // Capture the referring doctor or creator
        admission: admissionObjectId,
        tests: tests as any,
        status: "prescribed",
        subtotal: subtotal !== undefined ? Number(subtotal) : actualAmount,
        discountAmount: discountAmount !== undefined ? Number(discountAmount) : 0,
        discountReason: discountReason || undefined,
        totalAmount: actualAmount,
        paymentStatus: "paid",
        hospital: currentHospital,
      });
    }

    if (!order)
      return res.status(400).json({ message: "Invalid request components" });

    // Common Logic for all flows (Transaction & Cache)
    const hospitalId = (req as any).user?.hospital || order.hospital;
    if (!hospitalId)
      throw new Error("Hospital association missing for transaction");

    const calculatedPaidAmount = paidAmount !== undefined ? Number(paidAmount) : order.totalAmount;
    const calculatedBalance = balance !== undefined ? Number(balance) : 0;
    const isCompleted = calculatedBalance === 0;

    const transaction = await Transaction.create({
      user: order.patient,
      userModel: "Patient",
      hospital: hospitalId,
      subtotal: order.subtotal || order.totalAmount,
      discountAmount: order.discountAmount || 0,
      discountReason: order.discountReason || undefined,
      amount: order.totalAmount,
      type: "lab_test",
      status: isCompleted ? "completed" : "pending",
      paymentMode: paymentMode?.toLowerCase() === "due" ? "other" : (paymentMode?.toLowerCase() || "cash"),
      paymentDetails:
        paymentMode?.toLowerCase() === "mixed" ? mixedDetails : undefined,
      referenceId: order._id,
      date: new Date(),
      paidAmount: calculatedPaidAmount,
      balance: calculatedBalance,
      patientType: patientDetails?.patientType || "opd",
      originalPatientName: patientDetails?.originalPatientName || "",
      refDoctor: patientDetails?.refDoctor || "",
    });

    order.invoiceId = transaction._id as any;
    order.paymentStatus = isCompleted ? "paid" : "pending";
    order.detailedStatus = "Ordered";
    await order.save();

    // --- Record History ---
    await LabOrderStatusHistory.create({
      labOrderId: order._id,
      hospital: hospitalId,
      status: "Ordered",
      changedBy: (req as any).user?._id || order.referredBy,
      remarks: "Order created successfully",
    });

    // --- IPD Integration: Create Extra Charge if linked to admission ---
    if (order.admission && order.totalAmount > 0) {
      await IPDExtraCharge.create({
        patient: order.patient,
        admission: order.admission,
        hospital: hospitalId,
        category: "Lab",
        description: `Lab Order (${order.sampleId || order._id})`,
        amount: order.totalAmount,
        date: new Date(),
        addedBy: (req as any).user?._id || order.referredBy,
        status: "Active",
      });
      // Invalidate IPD billing cache
      await redisService.del(`ipd:bill:${order.admission.toString()}`);
    }
    // ------------------------------------------------------------------

    // Invalidate dashboard cache
    if (order.hospital) {
      const hId = order.hospital.toString();
      await labService.clearDashboardCache(hId);
      (req as any).io
        ?.to(`hospital_${hId}`)
        .emit("new_lab_order", { orderId: order._id });
      (req as any).io
        ?.to(`hospital_${hId}_lab`)
        .emit("new_lab_order", { orderId: order._id });
    }

    // Populate invoiceId to get the invoiceNumber in the response
    const populatedOrder = await LabOrder.findById(order._id).populate("invoiceId");

    res.status(201).json({
      message: "Lab order created",
      order: populatedOrder,
      bill: {
        invoiceId: (populatedOrder?.invoiceId as any)?.invoiceNumber || `LAB-${order?.invoiceId?.toString().slice(-6).toUpperCase() || order?._id.toString().slice(-6).toUpperCase()}`,
        createdAt: order?.createdAt,
      },
    });
  } catch (error) {
    // Rollback: If order created but transaction failed, delete the order
    if (order && order._id) {
      await LabOrder.findByIdAndDelete(order._id);
      console.log(
        "Rolling back LabOrder due to transaction failure:",
        order._id,
      );
    }
    const err = error as any;
    console.error("Create lab order error:", err);
    try { require('fs').appendFileSync('/tmp/lab_error.log', new Date().toISOString() + ' ' + (err.stack || err.message) + '\n'); } catch(e){}
    res.status(500).json({ message: err.message || "Server error", details: err.stack });
  }
};

// 2. Collect Sample (Step 2-3)
export const collectSample = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid Order ID format" });
  }
  try {
    const order = await LabOrder.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.status !== "prescribed") {
      return res.status(400).json({
        message: "Order must be in prescribed state to collect sample",
      });
    }

    order.status = "sample_collected";
    order.sampleCollectedAt = new Date();

    // Also update all individual tests to processing status
    if (order.tests && order.tests.length > 0) {
      order.tests.forEach((test: any) => {
        if (test.status === "pending") {
          test.status = "processing";
        }
      });
    }

    // PHASE 10: Barcode Generation
    if (order.hospital) {
      const config = await HospitalLabConfig.findOne({ hospital: order.hospital }).lean();
      if (config?.barcodeEnabled) {
        // Generate a 12 digit unique barcode using hospital ID + timestamp + random
        const uniqueString = Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000).toString().padStart(3, "0");
        order.sampleId = `BAR-${uniqueString}`;
      }
    }

    order.detailedStatus = "Collected";
    await order.save();

    await LabOrderStatusHistory.create({
      labOrderId: order._id,
      hospital: order.hospital,
      status: "Collected",
      changedBy: (req as any).user?._id,
      remarks: "Sample collected by technician",
    });

    if (order.hospital) {
      const hId = order.hospital.toString();
      await labService.clearDashboardCache(hId);
      (req as any).io
        ?.to(`hospital_${hId}`)
        .emit("sample_collected", { orderId: order._id });
      (req as any).io
        ?.to(`hospital_${hId}_lab`)
        .emit("sample_collected", { orderId: order._id });
    }

    res.json({ message: "Sample collected", order });
  } catch (error) {
    console.error("Collect Sample Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// 3. Enter Results (Step 3: Lab processes sample)
export const enterResult = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid Order ID format" });
  }
  const { tests, status: reqStatus } = req.body; // Expect full tests array or partial

  try {
    const order = await LabOrder.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const isEditingCompleted = order.status === "completed";

    if (tests && Array.isArray(tests)) {
      let hasCritical = false;

      // Bulk update tests
      tests.forEach((updatedTest: any) => {
        const testItem = order.tests.find(
          (t) => t._id.toString() === updatedTest._id,
        );
        if (testItem) {
          testItem.result = updatedTest.resultValue || updatedTest.result;
          testItem.remarks = updatedTest.remarks;
          testItem.isAbnormal = updatedTest.isAbnormal;
          
          // PHASE 9: Critical Value Alerts
          if (updatedTest.isCritical || updatedTest.isAbnormal) {
            hasCritical = true;
          }

          testItem.subTests = updatedTest.subTests;
          testItem.status = updatedTest.resultValue
            ? "completed"
            : testItem.status === "processing"
              ? "processing"
              : "pending";
        }
      });

      if (hasCritical && order.hospital) {
        // Emit critical alert to Doctor and Lab Head
        const hId = order.hospital.toString();
        (req as any).io?.to(`hospital_${hId}`).emit("critical_lab_result", { orderId: order._id, patient: order.patient });
      }
    }

    if (isEditingCompleted) {
      order.isEdited = true;
      order.editedAt = new Date();
      await order.save();

      await LabOrderStatusHistory.create({
        labOrderId: order._id,
        hospital: order.hospital,
        status: "Edited",
        changedBy: (req as any).user?._id,
        remarks: "Lab results edited after completion",
      });
    } else {
      if (reqStatus) {
        const targetStatus = reqStatus.toLowerCase();
        order.status = targetStatus === "completed" ? "completed" : "processing";

        if (order.status === "completed") {
          order.detailedStatus = "Approved";
          order.completedAt = new Date();
          // FORCE SYNC: If the whole order is marked completed, all tests must be completed
          order.tests.forEach((t: any) => {
            if (t.status !== "completed") {
              t.status = "completed";
            }
          });
          
          await LabOrderStatusHistory.create({
            labOrderId: order._id,
            hospital: order.hospital,
            status: "Approved",
            changedBy: (req as any).user?._id,
            remarks: "All results entered and order completed",
          });
        }
      } else {
        // Auto transition to "processing" if first result entered
        if (order.status === "sample_collected") {
          order.status = "processing";
          order.detailedStatus = "Processing";
        } else {
          order.detailedStatus = "Verified";
        }
      }

      order.resultsEnteredAt = new Date();
      await order.save();

      await LabOrderStatusHistory.create({
        labOrderId: order._id,
        hospital: order.hospital,
        status: order.detailedStatus,
        changedBy: (req as any).user?._id,
        remarks: "Result entered/verified for specific tests",
      });
    }

    // Invalidate dashboard cache
    if (order.hospital) {
      const hId = order.hospital.toString();
      await labService.clearDashboardCache(hId);
      (req as any).io
        ?.to(`hospital_${hId}`)
        .emit("lab_order_updated", { orderId: order._id });
      (req as any).io
        ?.to(`hospital_${hId}_lab`)
        .emit("lab_order_updated", { orderId: order._id });
    }

    // Re-fetch populated order to return full details
    const updatedOrder = await LabOrder.findById(id)
      .populate("patient", "name age gender mobile")
      .populate("doctor", "name")
      .populate("hospital", "name")
      .populate({
        path: "tests.test",
        select: "name testName unit price",
      });

    res.json({ message: "Results updated", order: updatedOrder });
  } catch (error) {
    console.error("Enter Result Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// NEW: Notify Doctor about Lab Results
// NEW: Notify Doctor AND Patient about Lab Results
export const notifyDoctorResults = async (req: Request, res: Response) => {
  const { id } = req.params; // Lab Order ID
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid Order ID format" });
  }
  const { createNotification } =
    await import("../../Notification/Controllers/notificationController.js");

  try {
    const order = await LabOrder.findById(id)
      .populate("patient", "name mobile email")
      .populate("doctor", "name email")
      .populate("hospital", "name")
      .populate("tests.test"); // Populate test details to get name

    if (!order) {
      return res.status(404).json({ message: "Lab order not found" });
    }

    if (order.status !== "completed" && order.status !== "processing") {
      return res.status(400).json({
        message: "Results must be entered before notifying",
      });
    }

    // Prepare notification data
    const notificationPayload = {
      type: "lab_result_ready",
      orderId: order._id,
      sampleId: (order as any).sampleId || order._id,
      patientName: (order.patient as any)?.name || "Unknown Patient",
      patientId: order.patient,
      doctor: order.doctor
        ? {
            _id: (order.doctor as any)?._id || order.doctor,
            name: (order.doctor as any)?.name || "Unknown Doctor",
            email: (order.doctor as any)?.email,
          }
        : { _id: null, name: "Self-Ordered" },
      hospital: {
        _id: (order.hospital as any)?._id || order.hospital,
        name: (order.hospital as any)?.name || "Unknown Hospital",
      },
      tests: order.tests.map((t: any) => ({
        name: t.testName || (t.test as any)?.testName || "Unknown Test",
        status: t.status,
        result: t.result,
        isAbnormal: t.isAbnormal,
      })),
      completedAt: order.completedAt || new Date(),
      timestamp: new Date().toISOString(),
      message: `Lab results ready for ${(order.patient as any)?.name || "patient"}`,
    };

    const io = (req as any).io;

    // --- 1. Notify Doctor ---
    if (order.doctor) {
      const rawId =
        (order.doctor as any)._id?.toString() || order.doctor.toString();
      let targetUserId = rawId;
      try {
        const drProfile = await DoctorProfile.findById(rawId)
          .select("user")
          .lean();
        if (drProfile && (drProfile as any).user) {
          targetUserId = (drProfile as any).user.toString();
        }
      } catch (e) {
        /* ignore */
      }

      console.log(
        `📡 Notifying doctor [User: ${targetUserId}] about lab results`,
      );

      if (io) {
        // Consolidate all intended recipients into a single broadcast
        // Sockets joined in multiple rooms will only receive the event once
        let broadcast = io
          .to(`doctor_${targetUserId}`)
          .to(`user_${targetUserId}`);

        if (targetUserId !== rawId) {
          broadcast = broadcast.to(`doctor_${rawId}`);
        }

        // We'll also include the hospital rooms in this single broadcast to be efficient
        if (order.hospital) {
          const hId =
            (order.hospital as any)._id?.toString() ||
            order.hospital.toString();
          broadcast = broadcast.to(`hospital_${hId}_doctor`);
        }

        broadcast.emit("lab_result_notification", notificationPayload);
      }

      // Persist Notification for Doctor
      await createNotification(req, {
        hospital: order.hospital,
        recipient: targetUserId,
        sender: (req as any).user?._id, // Lab Staff
        type: "lab_result_ready",
        message: `Lab results ready for ${(order.patient as any)?.name} (Order: ${order.tokenNumber || "N/A"})`,
        relatedId: order._id,
      });
    }

    // --- 2. Notify Patient ---
    if (order.patient) {
      const patientId =
        (order.patient as any)._id?.toString() || order.patient.toString();
      console.log(
        `📡 Notifying patient [User: ${patientId}] about lab results`,
      );

      if (io) {
        io.to(`patient_${patientId}`)
          .to(`user_${patientId}`)
          .emit("lab_result_notification", notificationPayload);
      }

      // Persist Notification for Patient
      await createNotification(req, {
        hospital: order.hospital,
        recipient: patientId,
        recipientModel: "Patient", // Use Patient model if separated
        sender: (req as any).user?._id,
        type: "lab_result_ready",
        message: `Dear ${(order.patient as any)?.name || "Patient"}, your lab results are ready. Click to view.`,
        relatedId: order._id,
      });
    }

    // --- 3. Notify Hospital Room (Lab Dashboard Status Update) ---
    if (order.hospital && io) {
      const hId =
        (order.hospital as any)._id?.toString() || order.hospital.toString();
      // This is a status update for dashboards, separate from result ready notification
      io.to(`hospital_${hId}`).emit("lab_order_updated", {
        orderId: order._id,
      });
    }

    // Mark as notified
    const updatedOrder = await LabOrder.findByIdAndUpdate(
      id,
      {
        $set: { doctorNotified: true },
      },
      { new: true, strict: false },
    );

    res.json({
      message: "Notifications sent to Doctor and Patient",
      notification: notificationPayload,
    });
  } catch (error: any) {
    console.error("Notify Results Error:", error);
    res.status(500).json({ message: "Failed to notify", error: error.message });
  }
};

// 4. Finalize Order & Billing (Step 3 -> 4)
// 4. Finalize Order & Billing (Step 3 -> 4)
export const finalizeOrder = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { totalAmount, items, patientDetails } = req.body;

  try {
    let order;
    if (mongoose.Types.ObjectId.isValid(id)) {
      order = await LabOrder.findById(id);
    } else {
      // Fallback for non-standard IDs
      const allOrders = await LabOrder.find();
      order = allOrders.find((o) =>
        o._id.toString().toUpperCase().endsWith(id.toUpperCase()),
      );
    }

    if (!order) return res.status(404).json({ message: "Order not found" });

    // ── Duplicate Invoice Guard ─────────────────────────────────────────────
    // If this order already has an invoice, block re-creation to prevent duplicates
    if (order.invoiceId) {
      console.warn(`[FinalizeOrder] Duplicate attempt blocked for order ${id}. Invoice: ${order.invoiceId}`);
      return res.status(409).json({
        message: "Invoice already generated for this order.",
        invoiceId: order.invoiceId,
        duplicate: true,
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    // Update Patient Details if provided (Fix for missing age/gender)
    if (patientDetails && order.patient) {
      const patient = await Patient.findById(order.patient);
      if (patient) {
        if (patientDetails.age !== undefined) patient.age = patientDetails.age;
        if (patientDetails.ageUnit) patient.ageUnit = patientDetails.ageUnit;
        if (patientDetails.gender)
          patient.gender = patientDetails.gender.toLowerCase();
        await patient.save();
      }
    }

    // Update billing details if provided
    if (totalAmount !== undefined) {
      order.totalAmount = totalAmount;
    }

    // Sync items/tests if provided
    if (items && Array.isArray(items) && items.length > 0) {
      // 1. Resolve all tests from DB
      const testIds = items.map((i: any) => i.testId).filter(Boolean);
      const testNames = items
        .filter((i: any) => !i.testId)
        .map((i: any) => i.testName);

      let foundTests: any[] = [];
      if (testIds.length > 0) {
        const byId = await LabTest.find({ _id: { $in: testIds } });
        foundTests = [...foundTests, ...byId];
      }
      if (testNames.length > 0) {
        const byName = await LabTest.find({
          $or: [{ name: { $in: testNames } }, { testName: { $in: testNames } }],
        });
        foundTests = [...foundTests, ...byName];
      }

      // 2. Map items to order tests, preserving existing state
      const updatedTests = items
        .map((item: any) => {
          let testDoc;
          if (item.testId) {
            testDoc = foundTests.find((t) => t._id.toString() === item.testId);
          } else {
            testDoc = foundTests.find(
              (t) =>
                (t.name &&
                  t.name.toLowerCase() === item.testName?.toLowerCase()) ||
                (t.testName &&
                  t.testName.toLowerCase() === item.testName?.toLowerCase()),
            );
          }

          if (!testDoc) return null;

          // Check if already exists in order
          const existingTest = order.tests.find(
            (t: any) => t.test && t.test.toString() === testDoc._id.toString(),
          );

          if (existingTest) {
            return existingTest;
          } else {
            // New test: include testName and resultParameters so results-entry page can render fields
            return {
              test: testDoc._id,
              testName: testDoc.testName || testDoc.name || item.testName,
              resultParameters: testDoc.resultParameters || [],
              price: testDoc.price || item.price || 0,
              status: "pending",
            };
          }
        })
        .filter(Boolean);

      if (updatedTests.length > 0) {
        order.tests = updatedTests as any;
      }
    }

    // Don't change status during billing - it should remain 'prescribed' until sample is collected
    // Only finalization happens here, not status progression
    if (order.status === "completed" && !order.completedAt) {
      order.completedAt = new Date();
    }

    // Step 4: Generate Invoice (Transaction) if not already exists
    let transaction;
    if (order.invoiceId) {
      transaction = await Transaction.findById(order.invoiceId);
    }

    if (!transaction) {
      let txHospital = order.hospital || (req as any).user?.hospital;

      // Fallback: Default Hospital if none associated
      if (!txHospital) {
        const defaultHospital = await Hospital.findOne();
        if (defaultHospital) txHospital = defaultHospital._id;
      }

      if (!txHospital)
        throw new Error("Hospital association missing for transaction");

      transaction = await Transaction.create({
        user: order.patient,
        userModel: "Patient",
        hospital: txHospital,
        amount: order.totalAmount,
        type: "lab_test",
        status: "pending",
        referenceId: order._id,
        date: new Date(),
        paidAmount: 0,
        balance: order.totalAmount,
        patientType: patientDetails?.patientType || "opd",
        originalPatientName: patientDetails?.originalPatientName || "",
        refDoctor: patientDetails?.refDoctor || "",
      });
      order.invoiceId = transaction._id as any;
    } else {
      // Update existing transaction amount if it changed
      if (totalAmount !== undefined && transaction.status === "pending") {
        transaction.amount = totalAmount;
        transaction.balance = totalAmount;
        await transaction.save();
      }
    }

    await order.save();

    // --- IPD Integration: Sync Extra Charge if linked to admission ---
    if (order.admission && order.totalAmount > 0) {
      // Upsert extra charge to avoid duplicates if finalized multiple times
      await IPDExtraCharge.findOneAndUpdate(
        { 
          admission: order.admission, 
          description: new RegExp(order._id.toString()) 
        },
        {
          patient: order.patient,
          admission: order.admission,
          hospital: order.hospital || (req as any).user?.hospital,
          category: "Lab",
          description: `Lab Order (${order.sampleId || order._id})`,
          amount: order.totalAmount,
          date: new Date(),
          addedBy: (req as any).user?._id,
          status: "Active",
        },
        { upsert: true, new: true }
      );
      // Invalidate IPD billing cache
      await redisService.del(`ipd:bill:${order.admission.toString()}`);
    }
    // ------------------------------------------------------------------

    // Invalidate dashboard cache
    if (order.hospital) {
      const hId = order.hospital.toString();
      await labService.clearDashboardCache(hId);
      (req as any).io
        ?.to(`hospital_${hId}`)
        .emit("bill_generated", { orderId: order._id });
      (req as any).io
        ?.to(`hospital_${hId}_lab`)
        .emit("bill_generated", { orderId: order._id });
    }

    res.json({
      message: "Order finalized and invoice generated",
      order,
      transaction,
    });
  } catch (error) {
    console.error("Finalize Order Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// 5. Pay for Order (Step 4: Billing)
export const payOrder = async (req: Request, res: Response) => {
  const { id } = req.params; // Order ID
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid Order ID format" });
  }
  const { paymentMode, paymentDetails: mixedDetails, paidAmount, balance } = req.body;
  try {
    const order = await LabOrder.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Auto-generate invoice/transaction if missing (Self-Healing)
    let transaction;
    if (order.invoiceId) {
      transaction = await Transaction.findById(order.invoiceId);
    }

    if (!transaction) {
      console.log(
        `[PayOrder] Invoice missing for order ${id}. Auto-generating...`,
      );
      let txHospital = order.hospital || (req as any).user?.hospital;

      // Fallback: Default Hospital if none associated
      if (!txHospital) {
        const defaultHospital = await Hospital.findOne();
        if (defaultHospital) txHospital = defaultHospital._id;
      }

      if (!txHospital)
        return res.status(400).json({
          message: "Hospital association missing, cannot generate invoice",
        });

      transaction = await Transaction.create({
        user: order.patient,
        userModel: "Patient",
        hospital: txHospital,
        amount: order.totalAmount,
        type: "lab_test",
        status: "pending",
        referenceId: order._id,
        date: new Date(),
        paidAmount: 0,
        balance: order.totalAmount,
      });

      order.invoiceId = transaction._id as any;
      await order.save();
    }

    const calculatedPaidAmount = paidAmount !== undefined ? Number(paidAmount) : transaction.amount;
    const calculatedBalance = balance !== undefined ? Number(balance) : 0;
    const isCompleted = calculatedBalance === 0;

    // Mixed Payment Validation
    if (paymentMode?.toLowerCase() === "mixed") {
      if (!mixedDetails)
        return res
          .status(400)
          .json({ message: "Payment details required for mixed mode" });
      const totalMixed =
        (mixedDetails.cash || 0) +
        (mixedDetails.card || 0) +
        (mixedDetails.upi || 0);
      if (Math.abs(totalMixed - calculatedPaidAmount) > 2) {
        return res.status(400).json({
          message: `Mixed payments (₹${totalMixed}) do not match paid amount (₹${calculatedPaidAmount})`,
        });
      }
    }

    transaction.status = isCompleted ? "completed" : "pending";
    if (paymentMode) {
      transaction.paymentMode = paymentMode.toLowerCase() as any;
    }
    if (mixedDetails) {
      transaction.paymentDetails = mixedDetails;
    }
    transaction.paidAmount = calculatedPaidAmount;
    transaction.balance = calculatedBalance;
    await transaction.save();

    order.paymentStatus = isCompleted ? "paid" : "pending";
    await order.save();

    // Invalidate dashboard cache
    if (order.hospital) {
      const hId = order.hospital.toString();
      await labService.clearDashboardCache(hId);

      const io = (req as any).io;

      // ── Populate patient + tests for rich notification messages ──────────
      const populatedOrder = await LabOrder.findById(order._id)
        .populate("patient", "name")
        .populate("tests.test", "testName name")
        .lean();

      const patientName = (populatedOrder?.patient as any)?.name || "Unknown Patient";
      const testNames = (populatedOrder?.tests || [])
        .map((t: any) => t.testName || (t.test as any)?.testName || (t.test as any)?.name || "")
        .filter(Boolean)
        .join(", ") || "Lab Tests";

      // Message templates
      const frontdeskMsg = `✅ ${patientName} has been billed for ${testNames}.`;
      const labMsg       = `💉 ${patientName} has paid for ${testNames} — please collect their sample.`;

      // ── 1. Emit to hospital-wide and role-specific socket rooms ───────────
      io?.to(`hospital_${hId}`).emit("payment_status_changed", {
        orderId:     order._id,
        patientName,
        testNames,
        message:     frontdeskMsg,
      });
      io?.to(`hospital_${hId}_lab`).emit("payment_status_changed", {
        orderId:     order._id,
        patientName,
        testNames,
        message:     labMsg,
      });
      io?.to(`hospital_${hId}_frontdesk`).emit("payment_status_changed", {
        orderId:     order._id,
        patientName,
        testNames,
        message:     frontdeskMsg,
      });
      io?.to(`hospital_${hId}_helpdesk`).emit("payment_status_changed", {
        orderId:     order._id,
        patientName,
        testNames,
        message:     frontdeskMsg,
      });

      // ── 2. Persist DB notifications for bell icons ─────────────────────
      try {
        const { createNotification } = await import(
          "../../Notification/Controllers/notificationController.js"
        );

        // Find all frontdesk + helpdesk + lab users in this hospital
        const staffUsers = await User.find({
          hospital: hId,
          role:     { $in: ["frontdesk", "helpdesk", "lab"] },
        })
          .select("_id role")
          .lean();

        const senderId = (req as any).user?._id;

        for (const staff of staffUsers) {
          const isLab     = (staff as any).role === "lab";
          const msgToSend = isLab ? labMsg : frontdeskMsg;

          await createNotification(req, {
            hospital:   hId,
            recipient:  (staff as any)._id,
            sender:     senderId,
            type:       "lab_payment_received",
            message:    msgToSend,
            relatedId:  order._id,
          });
        }
      } catch (notifErr) {
        // Non-fatal — log and continue
        console.error("[PayOrder] Notification dispatch error:", notifErr);
      }
    }

    res.json({ message: "Payment successful", order });
  } catch (error) {
    console.error("Pay Order Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// 6. Generate Invoice Data (Step 5: After Payment)
export const generateInvoice = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const order: any = await LabOrder.findById(id)
      .populate("patient", "name age gender mobile address")
      .populate("doctor", "name email")
      .populate("tests.test")
      .populate("invoiceId"); // Transaction

    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.paymentStatus !== "paid")
      return res
        .status(400)
        .json({ message: "Order must be paid to generate invoice" });

    // Fetch Hospital Details via Prescription -> Appointment -> Hospital
    // OR Doctor -> DoctorProfile -> Hospital
    let hospitalDetails: any = null;
    if (order.prescription) {
      const prescription: any = await Prescription.findById(
        order.prescription,
      ).populate({
        path: "appointment",
        populate: { path: "hospital" },
      });

      if (
        prescription &&
        prescription.appointment &&
        prescription.appointment.hospital
      ) {
        hospitalDetails = prescription.appointment.hospital;
      }
    }

    if (!hospitalDetails && order.doctor) {
      // Fallback to Doctor Profile
      const docProfile = await DoctorProfile.findOne({
        user: order.doctor._id,
      }).populate("hospital");
      if (docProfile && docProfile.hospital) {
        hospitalDetails = docProfile.hospital;
      }
    }

    // Prepare Invoice Data
    const invoiceData = {
      invoiceNumber: order.invoiceId?._id || "N/A",
      date: new Date(),
      hospital: hospitalDetails || {
        name: "Default Hospital",
        address: "City Center",
      },
      doctor: {
        name: order.doctor?.name || "Self-Ordered",
        email: order.doctor?.email || "N/A",
      },
      patient: {
        name: order.patient.name,
        age: order.patient.age,
        gender: order.patient.gender,
        mobile: order.patient.mobile,
        address: order.patient.address,
      },
      items: order.tests.map((t: any) => ({
        name: t.test.testName || t.test.name,
        price: t.test.price,
        discount: t.test.discount || 0,
        gst: t.test.gst || 0,
        finalPrice:
          (t.test.price - (t.test.price * (t.test.discount || 0)) / 100) *
          (1 + (t.test.gst || 0) / 100),
      })),
      medicines: order.prescription
        ? (await Prescription.findById(order.prescription))?.medicines
        : [],
      totalAmount: order.totalAmount,
      paymentMode: order.invoiceId?.paymentMode || "cash",
      paymentStatus: order.paymentStatus,
    };

    res.json(invoiceData);
  } catch (error) {
    console.error("Generate Invoice Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// 7. Get All Invoices (Admin/Hospital Admin)
export const getAllInvoices = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, page = 1, limit = 10 } = req.query;
    let query: any = { type: "lab_test" };

    const requester = (req as any).user;
    let hospitalId =
      requester?.role === "hospital-admin"
        ? requester.hospital
        : req.query.hospitalId || req.headers["x-hospital-id"];

    if (
      hospitalId &&
      typeof hospitalId === "string" &&
      mongoose.Types.ObjectId.isValid(hospitalId)
    ) {
      hospitalId = new mongoose.Types.ObjectId(hospitalId);
    }

    if (hospitalId) {
      query.hospital = hospitalId;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [invoices, total] = await Promise.all([
      Transaction.find(query)
        .populate("user", "name mobile age gender ageUnit") // Explicitly select fields
        .populate({
          path: "referenceId", // LabOrder
          model: "LabOrder",
          select: "tests totalAmount status patient doctor", // also select doctor for refDoctor
          populate: [
            {
              path: "tests.test",
              model: "LabTest",
              select: "testName name price",
            },
            {
              path: "patient", // Populate patient from order as fallback
              select: "name mobile age gender ageUnit",
            },
            {
              path: "doctor", // Populate doctor for Ref. Doctor field
              select: "name",
            },
          ],
        })
        .sort({ date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Transaction.countDocuments(query),
    ]);

    const mappedBills = invoices.map((inv: any) => {
      // Resolve User/Patient details from Transaction User OR Order Patient
      const userObj = inv.user || (inv.referenceId as any)?.patient || {};

      const items =
        inv.referenceId?.tests?.map((t: any) => ({
          testName: t.test?.testName || t.test?.name || "Unknown Test",
          price: t.test?.price || 0,
          discount: 0,
        })) || [];

      const pGender = userObj.gender
        ? userObj.gender.charAt(0).toUpperCase() + userObj.gender.slice(1)
        : "N/A";

      return {
        _id: inv._id,
        invoiceId: inv.invoiceNumber || `LAB-${inv._id.toString().slice(-6).toUpperCase()}`,
        patientType: inv.patientType || "opd",
        patientDetails: {
          name: userObj.name || "Walk-in",
          mobile: userObj.mobile || "N/A",
          age:
            userObj.age !== undefined && userObj.age !== null
              ? userObj.age
              : "N/A",
          gender: pGender,
          ageUnit: userObj.ageUnit || "Years",
          refDoctor: inv.patientType === "lab"
            ? (inv.refDoctor || "")
            : ((inv.referenceId as any)?.doctor?.name || (inv.referenceId as any)?.doctor || ""),
          originalPatientName: inv.originalPatientName || "",
          patientType: inv.patientType || "opd",
        },
        items: items,
        totalAmount: inv.amount,
        discount: 0,
        finalAmount: inv.amount, // Added for frontend compatibility
        paidAmount: inv.paidAmount !== undefined ? inv.paidAmount : (inv.status === "completed" ? inv.amount : 0),
        balance: inv.balance !== undefined ? inv.balance : (inv.status === "completed" ? 0 : inv.amount),
        status: inv.paidAmount !== undefined
          ? (inv.balance === 0 ? "Paid" : (inv.paidAmount === 0 ? "Due" : "Partial"))
          : (inv.status === "completed" ? "Paid" : "Due"),
        paymentMode: inv.paymentMode
          ? inv.paymentMode === "upi"
            ? "UPI"
            : inv.paymentMode.charAt(0).toUpperCase() + inv.paymentMode.slice(1)
          : "Cash",
        createdAt: inv.date || new Date(), // Using 'date' as per Transaction model
      };
    });

    res.json({
      bills: mappedBills,
      totalPages: Math.ceil(total / Number(limit)) || 1, // Ensure at least 1
      currentPage: Number(page),
    });
  } catch (error) {
    console.error("Get All Invoices Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Helpers for Catalog Management (Admin/Lab)
/**
 * AUTO-IMPORT TEST FROM UNIVERSAL MASTER
 * Seamlessly copies a UniversalLabTest to the hospital's LabTest collection.
 * Prices are set to suggestedPrice and priceReviewRequired flag is set.
 */
export const autoImportTest = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const { universalTestId } = req.body;
    if (!universalTestId) {
      return res.status(400).json({ message: "universalTestId is required" });
    }

    // 1. Fetch Universal Test
    const universalTest = await UniversalLabTest.findById(universalTestId).lean();
    if (!universalTest) {
      return res.status(404).json({ message: "Universal test not found" });
    }

    // 2. Fetch Universal Parameters
    const universalParams = await UniversalTestParameter.find({
      universalTestId,
      isActive: true,
    }).lean();

    // 3. Resolve Department (create if doesn't exist)
    let deptId: any = undefined;
    if (universalTest.departmentName) {
      let dept = await Department.findOne({
        hospital: hospitalId,
        name: universalTest.departmentName,
      });
      if (!dept) {
        dept = await Department.create({
          hospital: hospitalId,
          name: universalTest.departmentName,
        });
      }
      deptId = dept._id;
    }

    // 4. Map parameters to legacy format for `resultParameters` embedded array
    const resultParameters = universalParams.map((p, idx) => {
      let fieldType: "text" | "number" | "boolean" = "text";
      const rt = (p.resultType || "").toUpperCase();
      if (rt === "NUMBER" || rt === "NUMERIC") fieldType = "number";
      else if (rt === "BOOLEAN") fieldType = "boolean";
      return {
        label: p.name,
        unit: p.unit || "",
        normalRange: p.normalRange || "",
        fieldType,
        isRequired: p.mandatory,
        displayOrder: p.displayOrder || idx,
      };
    });

    // 5. Create LabTest
    const newLabTest = await LabTest.create({
      hospital: hospitalId,
      testName: universalTest.testName,
      name: universalTest.testName,
      universalTestId: universalTest._id,
      priceReviewRequired: true, // Requires admin to review the price later
      testCode: universalTest.testCode,
      shortName: universalTest.shortName,
      departmentId: deptId,
      category: universalTest.category,
      price: universalTest.suggestedPrice || 0, // Auto-import at suggested price
      sampleType: universalTest.sampleType,
      methodology: universalTest.methodology,
      turnaroundTime: universalTest.turnaroundTime,
      fastingRequired: universalTest.fastingRequired,
      isActive: true,
      resultParameters,
    });

    // 6. Create TestParameters (for the new architecture)
    const TestParameter = mongoose.model("TestParameter"); // Lazy load to avoid circular deps if any
    for (let i = 0; i < universalParams.length; i++) {
      const uParam = universalParams[i];
      await TestParameter.create({
        hospital: hospitalId,
        testId: newLabTest._id,
        name: uParam.name,
        subTestCode: uParam.subTestCode,
        unit: uParam.unit,
        normalRange: uParam.normalRange,
        resultType: uParam.resultType,
        criticalLow: uParam.criticalLow,
        criticalHigh: uParam.criticalHigh,
        mandatory: uParam.mandatory,
        displayOrder: uParam.displayOrder,
        formulaExpression: uParam.formulaExpression,
        isActive: true,
      });
    }

    // Clear Cache
    await redisService.del(`lab:tests:${hospitalId}`);

    res.status(201).json({
      success: true,
      message: "Test imported successfully from Universal Master",
      data: newLabTest,
    });
  } catch (error: any) {
    console.error("Auto Import Error:", error);
    if (error.code === 11000) {
      res.status(400).json({ message: "Test already exists in your laboratory catalog." });
    } else {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
};

export const createLabTest = async (req: Request, res: Response) => {
  try {
    const {
      testName,
      departmentId,
      departmentIds,
      price,
      sampleType,
      ...rest
    } = req.body;

    if (price < 0) {
      return res.status(400).json({ message: "Price cannot be negative" });
    }

    // Extract hospital ID from authenticated user (multi-tenancy)
    const hospitalId = (req as any).user?.hospital || req.body.hospitalId;
    if (!hospitalId) {
      return res
        .status(400)
        .json({ message: "Hospital ID is required for lab test creation" });
    }

      // Clean up rest to avoid sending empty strings as identifiers
      if (rest.testCode === "" || rest.testCode === null) delete rest.testCode;
      if (rest.code === "" || rest.code === null) delete rest.code;
  
      // FIX: MongoDB throws E11000 duplicate key on testCode: null.
      // To prevent this, if testCode is missing, generate a unique one.
      if (!rest.testCode) {
        rest.testCode = `TC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      }

    // Check for duplicate test name in the SAME hospital only
    if (testName) {
      const exists = await LabTest.findOne({ hospital: hospitalId, testName });
      if (exists) {
        return res.status(400).json({
          message: "Lab Test with this name already exists in this hospital",
        });
      }
    }

    const depts = departmentIds || (departmentId ? [departmentId] : []);

    const hospital = (req as any).user?.hospital;

    const test = await LabTest.create({
      hospital: hospitalId,
      testName,
      name: testName,
      departmentIds: depts,
      departmentId: depts[0], // Primary for compatibility
      price,
      sampleType: sampleType || "Blood",
      ...(hospital ? { hospital } : {}),
      ...rest,
    });

    // Invalidate caches
    if (hospitalId) {
      await redisService.del(`lab:tests:${hospitalId}`);
      await redisService.del(`lab:departments:${hospitalId}`);
    }
    await redisService.del("lab:tests:all");
    await redisService.del("lab:departments:all");

    return res.status(201).json({ message: "Test created successfully", test });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(400).json({
        message:
          "Lab Test with this name or code already exists in this hospital",
      });
    }
    console.error("Create Test Error:", error);
    return res.status(500).json({
      message: error.message || "Server error",
      error,
    });
  }
};

export const updateLabTest = async (req: Request, res: Response) => {
  try {
    const { testName, departmentId, departmentIds, price, ...rest } = req.body;
    const hospitalId = (req as any).user?.hospital || req.body.hospitalId;

    if (price !== undefined && price < 0) {
      return res.status(400).json({ message: "Price cannot be negative" });
    }

    if (rest.testCode === "") rest.testCode = undefined;
    if (rest.code === "") rest.code = undefined;

    const depts = departmentIds || (departmentId ? [departmentId] : []);

    const updateData: any = { ...rest };
    if (testName) {
      updateData.testName = testName;
      updateData.name = testName;
    }
    if (price !== undefined) updateData.price = price;
    if (depts.length > 0) {
      updateData.departmentIds = depts;
      updateData.departmentId = depts[0];
    }

    // Verify test belongs to user's hospital (multi-tenancy check)
    const findFilter: any = { _id: req.params.id };
    if (hospitalId) {
      findFilter.hospital = hospitalId;
    }

    const test = await LabTest.findOneAndUpdate(findFilter, updateData, {
      new: true,
    });

    if (!test)
      return res
        .status(404)
        .json({ message: "Test not found or not authorized" });

    // Invalidate hospital-specific caches
    if (hospitalId) {
      await redisService.del(`lab:tests:${hospitalId}`);
      await redisService.del(`lab:departments:${hospitalId}`);
    }
    await redisService.del("lab:tests:all");
    await redisService.del("lab:departments:all");

    return res.json({ message: "Test updated successfully", test });
  } catch (error: any) {
    console.error("Update Test Error:", error);
    return res.status(500).json({
      message: error.message || "Server error",
      error,
    });
  }
};

export const deleteLabTest = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital || req.body.hospitalId;

    // Verify test belongs to user's hospital (multi-tenancy check)
    const findFilter: any = { _id: req.params.id };
    if (hospitalId) {
      findFilter.hospital = hospitalId;
    }

    const test = await LabTest.findOneAndUpdate(findFilter, {
      isActive: false,
    });
    if (!test)
      return res
        .status(404)
        .json({ message: "Test not found or not authorized" });

    // Invalidate hospital-specific caches
    if (hospitalId) {
      await redisService.del(`lab:tests:${hospitalId}`);
      await redisService.del(`lab:departments:${hospitalId}`);
    }
    await redisService.del("lab:tests:all");
    await redisService.del("lab:departments:all");

    res.json({ message: "Test deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteAllLabTests = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital || req.body.hospitalId;

    // Delete only tests belonging to the user's hospital (multi-tenancy)
    const deleteFilter: any = {};
    if (hospitalId) {
      deleteFilter.hospital = hospitalId;
    } else {
      // Super admin can delete all tests across hospitals if necessary
      // but this should be rarely used
    }

    const result = await LabTest.updateMany(deleteFilter, { isActive: false });

    // Invalidate hospital-specific caches
    if (hospitalId) {
      await redisService.del(`lab:tests:${hospitalId}`);
      await redisService.del(`lab:departments:${hospitalId}`);
    }
    await redisService.del("lab:tests:all");
    await redisService.del("lab:departments:all");

    res.json({
      message: `${result.modifiedCount} lab tests deleted successfully`,
    });
  } catch (error) {
    console.error("Delete All Tests Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getLabTests = async (req: Request, res: Response) => {
  try {
    // Extract hospital ID from authenticated user (multi-tenancy) or query param
    // PRIORITY: 1. User's assigned hospital (strict) 2. Query param (only if user has no hospital/Super Admin)
    let hospitalId = (req as any).user?.hospital;

    // If user is Super Admin or has no hospital, allow query param override
    if (!hospitalId && (req as any).user?.role === "super-admin") {
      hospitalId = req.query.hospitalId;
    }
    // If still no hospitalId and we want to prevent leakage, we should maybe default to user's context or strict check
    // If NO hospital ID is present, we should NOT return all tests in a multi-tenant system unless intended.
    // Assuming for now if no hospitalId, we return empty or public tests.
    // But for safety:

    if (!hospitalId) {
      // If query param exists (e.g. public access if we ever unprotect), use it
      hospitalId = req.query.hospitalId;
    }

    // Create hospital-specific cache key
    const cacheKey = hospitalId ? `lab:tests:${hospitalId}` : "lab:tests:all";
    const cached = await redisService.get(cacheKey);
    if (cached) return res.json(cached);

    // Build filter query
    const testFilter: any = { isActive: { $ne: false } };
    if (hospitalId) {
      testFilter.hospital = hospitalId;
    } else {
      // SECURITY: If no hospital ID, do we return EVERYTHING?
      // Safest is to return NOTHING or only tests marked 'global' if any.
      // For now, let's enforce hospitalId for consistency unless specific logic exists.
      // However, to keep existing behavior for SuperAdmin viewing ALL, we leave it.
      // BUT, for Hospital Admin 2, they will have hospitalId, so they are safe.
    }

    const tests = await LabTest.find(testFilter)
      .populate("departmentIds")
      .populate("departmentId");

    const mappedTests = tests.map((test) => {
      const raw = test.toObject();
      const depts =
        raw.departmentIds &&
        Array.isArray(raw.departmentIds) &&
        raw.departmentIds.length > 0
          ? raw.departmentIds
          : raw.departmentId
            ? [raw.departmentId]
            : [];

      // Remove redundant raw fields
      const { departmentIds, ...cleanRaw } = raw;

      return {
        ...cleanRaw,
        name: raw.testName || raw.name,
        departments: depts,
        // Ensure departmentId is a single object for legacy compatibility
        departmentId:
          raw.departmentId ||
          (depts.length > 0 ? depts[0] : { name: "General", _id: "general" }),
      };
    });

    await redisService.set(cacheKey, mappedTests, 600); // 10 min cache
    res.json(mappedTests);
  } catch (error) {
    console.error("Get Lab Tests Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Helper to map backend LabOrder to frontend LabSample structure
export const mapOrderToSample = (o: any) => {
  // Helper to calculate age from DOB
  const calculateAge = (dob: string | Date) => {
    if (!dob) return 0;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const month = today.getMonth() - birthDate.getMonth();
    if (month < 0 || (month === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  // Resolve Bed Info from Admission
  let bedInfo: any = null;
  if (o.admission) {
    if (typeof o.admission === "object" && o.admission.bedId) {
      bedInfo = {
        bedId: o.admission.bedId,
        room: o.admission.roomName || "General",
        type: o.admission.bedType || "Standard",
      };
    } else if (o.resolvedBed) {
      bedInfo = o.resolvedBed;
    }
  }

  // Robust Doctor Name Fetching for list view
  let resolvedDoctorName = o.doctor?.name || o.doctor?.user?.name;
  if (!resolvedDoctorName && o.invoiceId?.refDoctor) {
    resolvedDoctorName = o.invoiceId.refDoctor;
  }

  // Determine patient details
  const patientDetails = o.walkInPatient
    ? {
        name: o.walkInPatient.name,
        age: o.walkInPatient.age,
        gender: o.walkInPatient.gender,
        mobile: o.walkInPatient.mobile,
        refDoctor: resolvedDoctorName || "Self",
        patientId: o.walkInPatient._id,
      }
    : {
        name: o.patient?.name || "Walk-in Patient",
        age:
          o.patient?.age ||
          (o.patientProfile?.dob ? calculateAge(o.patientProfile.dob) : 0),
        gender: o.patient?.gender || o.patientProfile?.gender || "Other",
        mobile: o.patient?.mobile || "N/A",
        refDoctor: resolvedDoctorName || "",
        patientId: o.patient?._id,
        bedInfo: bedInfo // Injected bed info
      };

  // Determine status mapping
  let statusMapped: "Pending" | "In Processing" | "Completed" = "Pending";
  if (o.status === "completed") statusMapped = "Completed";
  else if (
    ["sample_collected", "processing", "paid", "registered"].includes(o.status)
  ) {
    // Registered walk-ins are effectively pending, but for the Unified UI:
    if (["registered", "prescribed", "paid"].includes(o.status))
      statusMapped = "Pending";
    else statusMapped = "In Processing";
  }

  // Only use invoiceId for billing status - transactionId is for payment tracking only
  const invoiceId = o.invoiceId;
  const invoiceNumStr = invoiceId && (invoiceId as any).invoiceNumber 
    ? (invoiceId as any).invoiceNumber 
    : invoiceId 
      ? `LAB-${invoiceId.toString().slice(-6).toUpperCase()}` 
      : `ORDER-${o._id.toString().slice(-6).toUpperCase()}`;

  return {
    _id: o._id,
    isWalkIn: !!o.walkInPatient,
    billId: invoiceNumStr,
    sampleId: o.sampleId || o.orderNumber || o._id.toString().slice(-6).toUpperCase(),
    priority: o.priority || "routine",
    clinicalAnnotations: o.clinicalAnnotations || o.notes || "",
    invoiceId: invoiceId ? invoiceId._id ? invoiceId._id.toString() : invoiceId.toString() : undefined,
    paymentStatus: o.paymentStatus || "pending",
    patientDetails,
    sampleType: o.sampleType || "Blood/Urine",
    status: statusMapped,
    tests: (o.tests || []).map((t: any) => ({
      _id: t._id,
      testName:
        t.testName || t.test?.testName || t.test?.name || "Unknown Test",
      departmentName:
        t.test?.departmentId?.name || t.test?.departmentName || "General",
      price: t.test?.price || t.price || 0,
      resultValue: t.result,
      remarks: t.remarks,
      isAbnormal: t.isAbnormal || false,
      status: t.status === "completed" ? "Completed" : "Pending",
      unit: t.test?.unit || "N/A",
      method: t.test?.method || "N/A",
      testCode: t.test?.testCode || "N/A",
      shortName: t.test?.shortName || t.test?.testCode || "",
      normalRange: t.test?.normalRange || "N/A",
      normalRanges: t.test?.normalRanges,
      subTests: t.subTests || [],
      // Include resultParameters from either the test doc or the stored snapshot
      resultParameters: t.test?.resultParameters || t.resultParameters || [],
    })),
    createdAt: o.createdAt,
    collectionDate: o.sampleCollectedAt,
    reportDate: o.completedAt || o.resultsEnteredAt,
    isEdited: o.isEdited || false,
    editedAt: o.editedAt,
  };
};

export const getInternalOrders = async (req: Request, res: Response) => {
  try {
    const { status, page = 1, limit = 10, isEdited } = req.query;
    const hospitalId = (req as any).user?.hospital;

    let internalQuery: any = {};
    let directQuery: any = {};

    if (hospitalId) {
      internalQuery.hospital = hospitalId;
      directQuery.hospital = hospitalId;
    }

    if (isEdited === "true") {
      internalQuery.isEdited = true;
      directQuery.isEdited = true;
    }

    if (status && status !== "All Samples") {
      if (status === "Pending") {
        internalQuery.status = "prescribed";
        directQuery.status = { $in: ["registered", "paid"] };
      } else if (status === "In Processing") {
        internalQuery.status = { $in: ["sample_collected", "processing"] };
        directQuery.status = { $in: ["sample_collected", "processing"] };
      } else if (status === "Completed") {
        internalQuery.status = "completed";
        directQuery.status = "completed";
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, walkIns] = await Promise.all([
      LabOrder.find(internalQuery)
        .populate("patient doctor referredBy admission")
        .populate({
          path: "tests.test",
          options: { unscoped: true },
          populate: {
            path: "departmentId",
            select: "name",
            options: { unscoped: true },
          },
        })
        .sort({ createdAt: -1 })
        .lean(),
      DirectLabOrder.find(directQuery)
        .populate("walkInPatient")
        .populate({
          path: "tests.test",
          populate: { path: "departmentId", select: "name" },
        })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    // Fetch PatientProfiles for standard orders to get age/gender
    const patientIds = (orders as any[])
      .map((o) => o.patient?._id)
      .filter(Boolean);
    const profiles = await PatientProfile.find({
      user: { $in: patientIds },
    }).lean();
    const profileMap = new Map();
    profiles.forEach((p) => profileMap.set(p.user.toString(), p));

    // Resolve doctor names for orders where populate didn't work (doctor might be DoctorProfile ID)
    const unresolvedDoctorIds = (orders as any[])
      .filter((o) => o.doctor && !o.doctor.name)
      .map((o) => o.doctor._id || o.doctor);

    let doctorProfileMap = new Map();
    if (unresolvedDoctorIds.length > 0) {
      const drProfiles = await DoctorProfile.find({
        _id: { $in: unresolvedDoctorIds },
      })
        .populate("user", "name")
        .lean();
      drProfiles.forEach((dp: any) => {
        if (dp.user?.name) {
          doctorProfileMap.set(dp._id.toString(), dp.user.name);
        }
      });
    }

    // Attach profile and resolved doctor name to orders for mapping
    (orders as any[]).forEach((o) => {
      if (o.patient?._id) {
        o.patientProfile = profileMap.get(o.patient._id.toString());
      }
      // If doctor name not resolved via populate, try DoctorProfile fallback
      if (o.doctor && !o.doctor.name) {
        const doctorId = (o.doctor._id || o.doctor).toString();
        const resolvedName = doctorProfileMap.get(doctorId);
        if (resolvedName) {
          o.doctor = { _id: o.doctor._id || o.doctor, name: resolvedName };
        }
      }
      // Also try referredBy as fallback
      if ((!o.doctor || !o.doctor.name) && o.referredBy?.name) {
        o.doctor = { _id: o.referredBy._id, name: o.referredBy.name };
      }
    });

    // ✅ BED RESOLUTION: Fetch active bed for IPD orders
    const admissionIds = (orders as any[])
      .filter((o) => o.admission && !o.admission.bedId) // Only if not already enriched
      .map((o) => o.admission._id || o.admission);

    if (admissionIds.length > 0) {
      const occupancies = await (BedOccupancy.find({
        admission: { $in: admissionIds },
        endDate: { $exists: false },
      }) as any)
        .unscoped()
        .populate({
            path: 'bed',
            select: 'bedId room type',
            options: { unscoped: true }
        })
        .lean();
      
      const occMap = new Map();
      occupancies.forEach((occ: any) => {
        if (occ.admission) occMap.set(occ.admission.toString(), occ.bed);
      });

      (orders as any[]).forEach((o) => {
        if (o.admission) {
          const bed = occMap.get((o.admission._id || o.admission).toString());
          if (bed) {
            o.resolvedBed = {
              bedId: bed.bedId,
              room: bed.room,
              type: bed.type
            };
          }
        }
      });
    }

    // Merge all
    const allFetchedOrders = [...orders, ...walkIns].sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = allFetchedOrders.length;
    const paginatedSlice = allFetchedOrders.slice(skip, skip + Number(limit));
    const mappedOrders = paginatedSlice.map(mapOrderToSample);

    res.json({
      success: true,
      count: mappedOrders.length,
      total,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      data: mappedOrders,
    });
  } catch (error) {
    console.error("Get Internal Orders Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getLabOrder = async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid Order ID format" });
  }
  try {
    const order: any = await LabOrder.findById(req.params.id)
      .populate("patient doctor referredBy invoiceId")
      .populate({
        path: "tests.test",
        populate: { path: "departmentId", select: "name" },
      });

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Robust Doctor Name Fetching
    // Priority: 1) populated doctor name, 2) DoctorProfile lookup, 3) Transaction refDoctor, 4) "Self"
    // NOTE: referredBy stores who CREATED the request (e.g. lab technician), NOT the referring doctor
    let resolvedDoctorName = order.doctor?.name;
    if (!resolvedDoctorName && order.doctor) {
      // Check if order.doctor is actually a Profile ID
      const drProfile = await mongoose
        .model("DoctorProfile")
        .findOne({ _id: order.doctor })
        .populate("user", "name")
        .lean();
      if (drProfile && (drProfile as any).user?.name) {
        resolvedDoctorName = (drProfile as any).user.name;
      }
    }
    // Fallback: check Transaction's refDoctor field (set from billing form)
    if (!resolvedDoctorName && order.invoiceId?.refDoctor) {
      resolvedDoctorName = order.invoiceId.refDoctor;
    }

    // Debug Log
    console.log(
      `Fetching Order ${req.params.id} for ${order.patient?.name}. Resolved Doctor: ${resolvedDoctorName}`,
    );

    // Auto-expand profiles if sub-tests are missing
    const expandedTests = await Promise.all(
      order.tests.map(async (t: any) => {
        // ... (rest of the mapping)
        const mappedTest = {
          _id: t._id,
          testId: t.test?._id, // Keep reference to master test ID
          testName:
            t.test?.testName || t.test?.name || t.testName || "Unknown Test",
          departmentName: t.test?.departmentId?.name || "General",
          price: t.test?.price || t.price || 0,
          resultValue: t.result,
          remarks: t.remarks,
          isAbnormal: t.isAbnormal || false,
          status: t.status === "completed" ? "Completed" : "Pending",
          unit: t.test?.unit || "N/A",
          method: t.test?.method || "N/A",
          testCode: t.test?.testCode || "N/A",
          shortName: t.test?.shortName || t.test?.testCode || "",
          normalRange: t.test?.normalRange || "N/A", // String fallback
          normalRanges: t.test?.normalRanges, // Object for logic
          // Fall back to stored snapshot for newly-added tests without a populated reference
          resultParameters:
            t.test?.resultParameters || t.resultParameters || [], // ✅ Dynamic result fields
          subTests: t.subTests || [],
        };

        // If no subresults and test might have parameters (e.g. isProfile or just has params)
        if (mappedTest.subTests.length === 0 && t.test) {
          console.log(
            `Checking parameters for test: ${t.test.testName} (ID: ${t.test._id})`,
          );
          const params = await TestParameter.find({
            testId: t.test._id,
            isActive: { $ne: false },
          }).sort({ displayOrder: 1 });
          console.log(
            `  Found ${params.length} parameters for ${t.test.testName}`,
          );

          if (params.length > 0) {
            mappedTest.subTests = params.map((p) => ({
              name: p.name,
              result: "",
              unit: p.unit || "",
              range: "", // Frontend will compute this based on patient details
              normalRanges: p.normalRanges, // Pass full range object to frontend
            }));
          }
        }
        return mappedTest;
      }),
    );

    // Fetch PatientProfile for age/gender if not on User
    const profile = order.patient?._id
      ? await PatientProfile.findOne({ user: order.patient._id }).lean()
      : null;

    const calculateAge = (dob: any) => {
      if (!dob) return 0;
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age;
    };

    const result = {
      _id: order._id,
      billId: order.invoiceId && order.invoiceId.invoiceNumber
        ? order.invoiceId.invoiceNumber
        : order.invoiceId
          ? `LAB-${order.invoiceId._id?.toString().slice(-6).toUpperCase() || order.invoiceId.toString().slice(-6).toUpperCase()}`
          : `ORDER-${order._id.toString().slice(-6).toUpperCase()}`,
      sampleId: order.sampleId || order.orderNumber || order._id.toString().slice(-6).toUpperCase(),
      patientDetails: {
        name: order.patient?.name || "Walk-in Patient",
        age:
          order.patient?.age || (profile?.dob ? calculateAge(profile.dob) : 0),
        gender: order.patient?.gender || profile?.gender || "Other",
        mobile: order.patient?.mobile || "N/A",
        refDoctor: resolvedDoctorName || "Self",
      },
      doctor: {
        _id: order.doctor?._id || order.doctor,
        name: resolvedDoctorName || "Assigned Physician",
      },
      hospital: order.hospital,
      referredBy: resolvedDoctorName || "Self",
      sampleType: "Blood/Urine",
      status:
        order.status === "prescribed"
          ? "Pending"
          : order.status === "completed"
            ? "Completed"
            : "In Processing",
      doctorNotified: order.doctorNotified,
      tests: expandedTests,
      createdAt: order.createdAt,
      collectionDate: order.sampleCollectedAt,
      reportDate: order.completedAt || order.resultsEnteredAt,
    };

    res.json(result);
  } catch (error) {
    console.error("Get Lab Order Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteLabOrder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const order = await LabOrder.findByIdAndDelete(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Notify Lab via Socket for real-time count updates
    if (order.hospital) {
      const hId = order.hospital.toString();
      (req as any).io?.to(`hospital_${hId}`).emit("lab_order_updated", { orderId: id });
      (req as any).io?.to(`hospital_${hId}_lab`).emit("lab_order_updated", { orderId: id });
    }

    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error("Delete Lab Order Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getLabTest = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital || req.body.hospitalId;

    // Build filter to ensure hospital isolation
    const filter: any = { _id: req.params.id };
    if (hospitalId) {
      filter.hospital = hospitalId;
    }

    const test = await LabTest.findOne(filter)
      .populate({ path: "departmentId", model: Department })
      .populate({ path: "testGroupId", model: TestGroup });

    if (!test)
      return res
        .status(404)
        .json({ message: "Test not found or not authorized" });

    const mappedTest = {
      ...test.toObject(),
      name: test.testName || test.name,
      departmentId: test.departmentId || { name: "General", _id: "general" },
    };
    res.json(mappedTest);
  } catch (error) {
    console.error("Get Lab Test Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getTestParameters = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parameters = await TestParameter.find({
      testId: id,
      isActive: { $ne: false },
    }).sort({ displayOrder: 1 });
    res.json(parameters);
  } catch (error) {
    console.error("Get Test Parameters Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Meta APIs
export const getMetaOptions = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    const defaultMeta = {
      testNames: [
        "Complete Blood Count",
        "Blood Sugar (Fasting)",
        "Blood Sugar (PP)",
        "HbA1c",
        "Lipid Profile",
        "Liver Function Test",
        "Kidney Function Test",
        "Thyroid Profile (T3, T4, TSH)",
        "Urine Routine & Microscopy",
        "Widal Test",
        "Dengue NS1 Antigen",
        "C-Reactive Protein (CRP)",
        "Vitamin D",
        "Vitamin B12",
        "HBsAg",
        "HIV I & II",
        "TSH (Ultra-sensitive)",
      ],
      methods: [
        "Automated Analyzer",
        "ELISA",
        "CLIA",
        "Spectrophotometry",
        "Manual",
        "Microscopy",
      ],
      sampleTypes: [
        "Blood",
        "Serum",
        "Plasma",
        "Urine",
        "Stool",
        "Sputum",
        "Swab",
        "Pus",
        "CSF",
        "Body Fluid",
        "Semen",
      ],
      turnaroundTimes: [
        "2 Hours",
        "4 Hours",
        "Same Day",
        "24 Hours",
        "48 Hours",
        "3-5 Days",
      ],
      units: [
        "mg/dL",
        "mmol/L",
        "g/dL",
        "%",
        "copies/mL",
        "IU/mL",
        "pg/mL",
        "ng/mL",
        "mIU/L",
        "L",
        "Cells/cumm",
        "Mill cells/cumm",
      ],
      departmentNames: [
        "Haematology",
        "Biochemistry",
        "Microbiology",
        "Serology",
        "Clinical Pathology",
        "Histopathology",
        "Immunology",
        "Molecular Biology",
        "Cytology",
        "Radiology",
        "Endocrinology",
        "Hormony Assays",
        "ImmunoAssays",
        "Urine",
      ],
    };

    if (hospitalId) {
      let config = await HospitalLabConfig.findOne({ hospital: hospitalId });
      if (!config) {
        config = await HospitalLabConfig.create({
          hospital: hospitalId,
          enabledDepartments: [],
          barcodeEnabled: false,
          qrVerificationEnabled: false,
          allowCustomTests: true,
          methods: defaultMeta.methods,
          sampleTypes: defaultMeta.sampleTypes,
          units: defaultMeta.units,
        });
      }
      return res.json({
        ...defaultMeta,
        methods: (config.methods && config.methods.length > 0) ? config.methods : defaultMeta.methods,
        sampleTypes: (config.sampleTypes && config.sampleTypes.length > 0) ? config.sampleTypes : defaultMeta.sampleTypes,
        units: (config.units && config.units.length > 0) ? config.units : defaultMeta.units,
      });
    }

    res.json(defaultMeta);
  } catch (error) {
    console.error("Get Meta Options Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateMetaOptions = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }
    const { methods, sampleTypes, units } = req.body;

    const config = await HospitalLabConfig.findOneAndUpdate(
      { hospital: hospitalId },
      {
        $set: {
          ...(methods !== undefined && { methods }),
          ...(sampleTypes !== undefined && { sampleTypes }),
          ...(units !== undefined && { units }),
        },
      },
      { new: true, upsert: true }
    );

    res.json({ success: true, message: "Meta options updated successfully", data: config });
  } catch (error: any) {
    console.error("Update Meta Options Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};


// Department Management APIs
export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;

    // Extract hospital ID from authenticated user (multi-tenancy)
    const hospitalId = (req as any).user?.hospital || req.body.hospitalId;
    if (!hospitalId) {
      return res
        .status(400)
        .json({ message: "Hospital ID is required for department creation" });
    }

    // Check for duplicate department in the SAME hospital only
    const exists = await Department.findOne({ hospital: hospitalId, name });
    if (exists)
      return res
        .status(400)
        .json({ message: "Department already exists in this hospital" });

    const department = await Department.create({
      hospital: hospitalId,
      name,
      description,
    });

    // Invalidate caches
    await redisService.del("lab:departments:all");
    if (hospitalId) {
      await redisService.del(`lab:departments:${hospitalId}`);
    }

    res.status(201).json({ message: "Department created", department });
  } catch (error) {
    if ((error as any).code === 11000) {
      return res
        .status(400)
        .json({ message: "Department already exists in this hospital" });
    }
    console.error("Create Department Error:", error);
    res
      .status(500)
      .json({ message: (error as any)?.message || "Server error" });
  }
};

export const getDepartments = async (req: Request, res: Response) => {
  try {
    // Extract hospital ID from authenticated user (multi-tenancy) or query param
    let hospitalId = (req as any).user?.hospital;
    if (!hospitalId && (req as any).user?.role === "super-admin") {
      hospitalId = req.query.hospitalId;
    }
    if (!hospitalId) {
      hospitalId = req.query.hospitalId;
    }

    // Create hospital-specific cache key
    const cacheKey = hospitalId
      ? `lab:departments:${hospitalId}`
      : "lab:departments:all";
    const cached = await redisService.get(cacheKey);
    if (cached) return res.json(cached);

    // Build filter query
    const departmentFilter: any = { isActive: { $ne: false } };
    const testFilter: any = { isActive: { $ne: false } };

    if (hospitalId) {
      departmentFilter.hospital = hospitalId;
      testFilter.hospital = hospitalId;
    } else {
      // 🚀 SECURITY: Prevent leaking data across tenants if no hospital context
      return res.json([]);
    }

    const [departments, allTests] = await Promise.all([
      Department.find(departmentFilter),
      LabTest.find(testFilter).select(
        "testName price departmentId departmentIds",
      ),
    ]);

    // Group tests by department in memory to avoid N+1
    const results = departments.map((dept) => {
      const deptIdStr = dept._id.toString();
      const deptTests = allTests.filter((test) => {
        const primaryDept = test.departmentId?.toString();
        const otherDepts = test.departmentIds?.map((id) => id.toString()) || [];
        return primaryDept === deptIdStr || otherDepts.includes(deptIdStr);
      });

      return {
        ...dept.toObject(),
        tests: deptTests,
        testCount: deptTests.length,
      };
    });

    await redisService.set(cacheKey, results, 600); // 10 min cache
    res.json(results);
  } catch (error: any) {
    console.error("Get Departments Error:", error);
    res.status(500).json({ message: error?.message || "Server error" });
  }
};

export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const hospitalId = (req as any).user?.hospital || req.body.hospitalId;

    // Verify department belongs to user's hospital (multi-tenancy check)
    const findFilter: any = { _id: id };
    if (hospitalId) {
      findFilter.hospital = hospitalId;
    }

    const department = await Department.findOneAndUpdate(findFilter, req.body, {
      new: true,
    });
    if (!department)
      return res
        .status(404)
        .json({ message: "Department not found or not authorized" });
    // Invalidate caches
    if (hospitalId) {
      await redisService.del(`lab:departments:${hospitalId}`);
    }
    await redisService.del("lab:departments:all");

    res.json({ message: "Department updated", department });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const hospitalId = (req as any).user?.hospital || req.body.hospitalId;

    // Verify department belongs to user's hospital (multi-tenancy check)
    const findFilter: any = { _id: id };
    if (hospitalId) {
      findFilter.hospital = hospitalId;
    }

    // Soft delete
    const department = await Department.findOneAndUpdate(
      findFilter,
      { isActive: false },
      { new: true },
    );
    if (!department)
      return res
        .status(404)
        .json({ message: "Department not found or not authorized" });

    // Invalidate hospital-specific caches
    if (hospitalId) {
      await redisService.del(`lab:departments:${hospitalId}`);
    }
    await redisService.del("lab:departments:all");

    res.json({ message: "Department deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// 8. Delete Invoice/Transaction
export const deleteInvoice = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const transaction = await Transaction.findByIdAndDelete(id);

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    res.json({ message: "Transaction deleted successfully" });
  } catch (error) {
    console.error("Delete Invoice Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const { range = "today", skipCache = "false", startDate, endDate } = req.query;
    const hospitalId = (req as any).user?.hospital;

    // As per user request, we are syncing with Lab Dashboard which shows global stats
    // We pass "" to bypass hospital filtering and show all data including orphaned/walk-in orders
    const stats = await labService.getDashboardStats(
      "", // Force global/unfiltered stats
      range as string,
      skipCache !== "true",
      startDate as string,
      endDate as string
    );

    res.json(stats);
  } catch (error: any) {
    console.error("Lab Stats Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// BULK IMPORT HANDLERS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /lab/departments/bulk
 * Body: { departments: [{ name, code, description, isActive }] }
 * Creates or skips (if duplicate) each department for the authenticated hospital.
 */
export const bulkImportDepartments = async (req: Request, res: Response) => {
  try {
    const hospitalId = (req as any).user?.hospital;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const rows: any[] = req.body.departments;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No department rows provided" });
    }

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const name = (row.name || row.Name || "").trim();
      if (!name) {
        errors.push(`Row missing Name`);
        continue;
      }

      try {
        const existing = await Department.findOne({
          hospital: hospitalId,
          name,
        });
        if (existing) {
          skipped++;
          continue;
        }

        await Department.create({
          hospital: hospitalId,
          name,
          code: row.code || row.Code || undefined,
          description: row.description || row.Description || undefined,
          isActive:
            row.isActive === false || row.IsActive === "FALSE" ? false : true,
        });
        created++;
      } catch (e: any) {
        if (e.code === 11000) {
          skipped++;
        } else errors.push(`${name}: ${e.message}`);
      }
    }

    // Invalidate department cache
    await redisService.del(`lab:departments:${hospitalId}`);
    await redisService.del("lab:departments:all");

    res.json({ message: "Bulk import complete", created, skipped, errors });
  } catch (error: any) {
    console.error("Bulk Import Departments Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * POST /lab/tests/bulk
 * Supports TWO formats:
 *
 * FORMAT 1 (NEW — Parent → Sub-Test rows):
 *   Each row has: testCode, testName, subTestName, unit, normalRange, resultType, etc.
 *   Rows sharing the same testCode are grouped:
 *     - First row → creates parent LabTest
 *     - All rows → create TestParameter documents linked to parent
 *
 * FORMAT 2 (LEGACY — flat columns):
 *   Single row per test with Result_1, Result_1_Unit, Result_1_Range, etc.
 *
 * Auto-detection: If any row has a non-empty `subTestName` column, use Format 1.
 */
export const bulkImportTests = async (req: Request, res: Response) => {
  try {
    let hospitalId = (req as any).user?.hospital;
    if ((req as any).user?.role === "super-admin") {
      hospitalId = req.body.hospitalId || req.query.hospitalId || req.headers["x-hospital-id"] || hospitalId;
    }

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital context required" });
    }

    const rows: any[] = req.body.tests;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No test rows provided" });
    }

    // Cache departments by name for this import session
    const deptCache: Map<string, mongoose.Types.ObjectId> = new Map();
    const existingDepts = await Department.find({
      hospital: hospitalId,
    }).lean();
    for (const d of existingDepts) {
      deptCache.set(d.name.toLowerCase(), d._id as mongoose.Types.ObjectId);
    }

    const getOrCreateDept = async (
      name: string,
    ): Promise<mongoose.Types.ObjectId | undefined> => {
      if (!name) return undefined;
      const key = name.toLowerCase();
      if (deptCache.has(key)) return deptCache.get(key);
      try {
        const d = await Department.create({ hospital: hospitalId, name });
        deptCache.set(key, d._id as mongoose.Types.ObjectId);
        return d._id as mongoose.Types.ObjectId;
      } catch (e: any) {
        // Might already exist due to race
        const existing = await Department.findOne({
          hospital: hospitalId,
          name,
        }).lean();
        if (existing) {
          deptCache.set(key, existing._id as mongoose.Types.ObjectId);
          return existing._id as mongoose.Types.ObjectId;
        }
        return undefined;
      }
    };

    const forceUpdate: boolean = !!req.body.forceUpdate;

    // ── Auto-detect format ──────────────────────────────────────────────
    const hasSubTestColumn = rows.some(
      (r) =>
        (r.subTestName || r.SubTestName || r["sub test name"] || "")
          .toString()
          .trim() !== "",
    );

    if (hasSubTestColumn) {
      // ══════════════════════════════════════════════════════════════════
      // FORMAT 1: Parent → Sub-Test rows (NEW)
      // ══════════════════════════════════════════════════════════════════
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let subTestsCreated = 0;
      const errors: string[] = [];

      // Group rows by testCode
      const groupedTests: Map<string, any[]> = new Map();
      for (const row of rows) {
        const testCode = (
          row.testCode ||
          row.TestCode ||
          row["test code"] ||
          ""
        )
          .toString()
          .trim();
        if (!testCode) {
          errors.push(
            `Row missing testCode (subTestName: ${row.subTestName || "unknown"})`,
          );
          continue;
        }
        if (!groupedTests.has(testCode)) {
          groupedTests.set(testCode, []);
        }
        groupedTests.get(testCode)!.push(row);
      }

      // Process each test group
      for (const [testCode, groupRows] of groupedTests) {
        const firstRow = groupRows[0];
        const testName = (
          firstRow.testName ||
          firstRow.TestName ||
          firstRow["test name"] ||
          ""
        )
          .toString()
          .trim();

        if (!testName) {
          errors.push(`testCode ${testCode}: Missing testName in first row`);
          continue;
        }

        const price =
          parseFloat(firstRow.price || firstRow.Price || "0") || 0;

        try {
          // Resolve department
          const deptName = (
            firstRow.departmentName ||
            firstRow.DepartmentName ||
            firstRow.department ||
            firstRow.category ||
            firstRow.Category ||
            ""
          )
            .toString()
            .trim();
          const deptId = deptName
            ? await getOrCreateDept(deptName)
            : undefined;

          // Build resultParameters for backward compat (embedded in LabTest)
          const resultParameters: any[] = groupRows.map((row, idx) => {
            const subTestName = (
              row.subTestName ||
              row.SubTestName ||
              row["sub test name"] ||
              ""
            )
              .toString()
              .trim();
            const resultTypeRaw = (
              row.resultType ||
              row.ResultType ||
              row["result type"] ||
              "TEXT"
            )
              .toString()
              .toUpperCase()
              .trim();
            const fieldType =
              resultTypeRaw === "NUMBER" ? "number" : "text";

            return {
              label: subTestName,
              unit: (row.unit || row.Unit || "").toString().trim(),
              normalRange: (
                row.normalRange ||
                row.NormalRange ||
                row["normal range"] ||
                ""
              )
                .toString()
                .trim(),
              fieldType,
              isRequired:
                (row.mandatory || row.Mandatory || "FALSE")
                  .toString()
                  .toUpperCase() === "TRUE",
              displayOrder:
                parseInt(row.displayOrder || row.DisplayOrder || "0") ||
                idx,
            };
          });

          const testPayload: any = {
            hospital: hospitalId,
            testName,
            name: testName,
            price,
            testCode,
            sampleType: (
              firstRow.sampleType ||
              firstRow.SampleType ||
              "Blood"
            )
              .toString()
              .trim(),
            shortName: firstRow.shortName || firstRow.ShortName || undefined,
            category:
              firstRow.category || firstRow.Category || undefined,
            methodology:
              firstRow.methodology ||
              firstRow.Methodology ||
              undefined,
            turnaroundTime: (
              firstRow.turnaroundTime ||
              firstRow.TurnaroundTime ||
              "24 Hours"
            )
              .toString()
              .trim(),
            departmentId: deptId,
            fastingRequired:
              (
                firstRow.fastingRequired ||
                firstRow.FastingRequired ||
                "FALSE"
              )
                .toString()
                .toUpperCase() === "TRUE",
            isActive:
              firstRow.isActive === false ||
              (firstRow.isActive || "TRUE").toString().toUpperCase() ===
                "FALSE"
                ? false
                : true,
            resultParameters,
          };

          let parentTest: any;

          if (forceUpdate) {
            // Upsert parent test
            const existingTest = await LabTest.findOne({
              hospital: hospitalId,
              $or: [{ testCode }, { testName }],
            });

            if (existingTest) {
              const { hospital, ...updatePayload } = testPayload;
              // Ensure we reactivate the test if it was inactive
              updatePayload.isActive = true;

              await LabTest.updateOne(
                { _id: existingTest._id },
                { $set: updatePayload },
              );
              parentTest = await LabTest.findById(existingTest._id);
              updated++;

              // Delete old TestParameter documents for re-creation
              await TestParameter.deleteMany({
                hospital: hospitalId,
                testId: existingTest._id,
              });
            } else {
              parentTest = await LabTest.create(testPayload);
              created++;
            }
          } else {
            // Skip if already exists
            const existing = await LabTest.findOne({
              hospital: hospitalId,
              $or: [{ testCode }, { testName }],
            });
            if (existing) {
              skipped++;
              continue;
            }
            parentTest = await LabTest.create(testPayload);
            created++;
          }

          // Create TestParameter documents for each sub-test row
          for (let idx = 0; idx < groupRows.length; idx++) {
            const row = groupRows[idx];
            const subTestName = (
              row.subTestName ||
              row.SubTestName ||
              row["sub test name"] ||
              ""
            )
              .toString()
              .trim();

            if (!subTestName) continue;

            const resultTypeRaw = (
              row.resultType ||
              row.ResultType ||
              row["result type"] ||
              "TEXT"
            )
              .toString()
              .toUpperCase()
              .trim();

            const validTypes = [
              "NUMBER",
              "TEXT",
              "POSITIVE_NEGATIVE",
              "TRUE_FALSE",
              "DROPDOWN",
              "MULTISELECT",
              "FORMULA",
            ];
            const resultType = validTypes.includes(resultTypeRaw)
              ? resultTypeRaw
              : "TEXT";

            try {
              await TestParameter.create({
                hospital: hospitalId,
                testId: parentTest._id,
                name: subTestName,
                subTestCode: (
                  row.subTestCode ||
                  row.SubTestCode ||
                  ""
                )
                  .toString()
                  .trim() || undefined,
                unit: (row.unit || row.Unit || "").toString().trim() ||
                  undefined,
                normalRange: (
                  row.normalRange ||
                  row.NormalRange ||
                  row["normal range"] ||
                  ""
                )
                  .toString()
                  .trim() || undefined,
                resultType,
                criticalLow:
                  row.criticalLow || row.CriticalLow || undefined,
                criticalHigh:
                  row.criticalHigh || row.CriticalHigh || undefined,
                mandatory:
                  (row.mandatory || row.Mandatory || "FALSE")
                    .toString()
                    .toUpperCase() === "TRUE",
                displayOrder:
                  parseInt(
                    row.displayOrder || row.DisplayOrder || "0",
                  ) || idx,
                formulaExpression:
                  resultType === "FORMULA"
                    ? row.formulaExpression ||
                      row.FormulaExpression ||
                      undefined
                    : undefined,
                isActive: true,
              });
              subTestsCreated++;
            } catch (paramErr: any) {
              errors.push(
                `${testCode}/${subTestName}: ${paramErr.message}`,
              );
            }
          }
        } catch (e: any) {
          if (e.code === 11000) {
            if (forceUpdate) {
              updated++;
            } else {
              skipped++;
            }
          } else {
            errors.push(`${testCode} (${testName}): ${e.message}`);
          }
        }
      }

      // Invalidate test cache
      await redisService.del(`lab:tests:${hospitalId}`);

      res.json({
        message: "Bulk import complete (Parent → Sub-Test format)",
        created,
        updated,
        skipped,
        subTestsCreated,
        errors,
        debug: { forceUpdate, reqBodyForceUpdate: req.body.forceUpdate }
      });
    } else {
      // ══════════════════════════════════════════════════════════════════
      // FORMAT 2: Legacy flat columns (Result_1, Result_2, ...)
      // ══════════════════════════════════════════════════════════════════
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const row of rows) {
        const testName = (
          row.testName ||
          row.TestName ||
          row["Test Name"] ||
          ""
        ).trim();
        if (!testName) {
          errors.push(`Row missing TestName`);
          continue;
        }

        const price = parseFloat(row.price || row.Price || "0") || 0;

        try {
          // Resolve department
          const deptName = (
            row.departmentName ||
            row.DepartmentName ||
            row.Category ||
            row.category ||
            ""
          ).trim();
          const deptId = deptName
            ? await getOrCreateDept(deptName)
            : undefined;

          // Build resultParameters from columns Result_1, Result_2, ... up to 15
          const resultParameters: any[] = [];
          if (Array.isArray(row.resultParameters)) {
            resultParameters.push(...row.resultParameters);
          } else {
            // Parse from flat columns
            let consecutiveEmpty = 0;
            for (let i = 1; i <= 15; i++) {
              const label = (
                row[`Result_${i}`] ||
                row[`result_${i}`] ||
                row[`label_${i}`] ||
                row[`Result_${i.toString().padStart(2, "0")}`] ||
                ""
              )
                .toString()
                .trim();

              if (!label || label === "-") {
                consecutiveEmpty++;
                if (consecutiveEmpty >= 3) break;
                continue;
              }
              consecutiveEmpty = 0;

              resultParameters.push({
                label,
                unit: (
                  row[`Result_${i}_Unit`] ||
                  row[`result_${i}_unit`] ||
                  row[`unit_${i}`] ||
                  ""
                )
                  .toString()
                  .trim(),
                normalRange: (
                  row[`Result_${i}_Range`] ||
                  row[`result_${i}_range`] ||
                  row[`range_${i}`] ||
                  ""
                )
                  .toString()
                  .trim(),
                fieldType:
                  (
                    row[`Result_${i}_type`] ||
                    row[`result_${i}_type`] ||
                    row[`type_${i}`] ||
                    "text"
                  )
                    .toString()
                    .toLowerCase() === "number"
                    ? "number"
                    : "text",
                isRequired:
                  (
                    row[`Result_${i}_Required`] ||
                    row[`result_${i}_required`] ||
                    row[`required_${i}`] ||
                    "FALSE"
                  )
                    .toString()
                    .toUpperCase() === "TRUE",
                displayOrder: i - 1,
              });
            }
          }

          const testPayload = {
            hospital: hospitalId,
            testName,
            name: testName,
            price,
            sampleType: (row.sampleType || row.SampleType || "Blood")
              .toString()
              .trim(),
            unit:
              (row.unit || row.Unit || "").toString().trim() || undefined,
            testCode: row.testCode || row.TestCode || undefined,
            shortName: row.shortName || row.ShortName || undefined,
            category: row.category || row.Category || undefined,
            methodology:
              row.methodology ||
              row.Methodology ||
              row.MentionTo ||
              undefined,
            turnaroundTime: (
              row.turnaroundTime ||
              row.TurnaroundTime ||
              "24 Hours"
            )
              .toString()
              .trim(),
            departmentId: deptId,
            fastingRequired:
              (row.fastingRequired || row.FastingRequired || "FALSE")
                .toString()
                .toUpperCase() === "TRUE",
            isActive:
              row.isActive === false ||
              (row.isActive || "TRUE").toString().toUpperCase() === "FALSE"
                ? false
                : true,
            resultParameters,
          };

          if (forceUpdate) {
            const existingTest = await LabTest.findOne({
              hospital: hospitalId,
              testName,
            });

            if (existingTest) {
              const { hospital, ...updatePayload } = testPayload;
              updatePayload.isActive = true;
              await LabTest.updateOne(
                { _id: existingTest._id },
                { $set: updatePayload },
              );
              updated++;
            } else {
              await LabTest.create(testPayload);
              created++;
            }
          } else {
            // Skip if already exists
            const existing = await LabTest.findOne({
              hospital: hospitalId,
              testName,
            });
            if (existing) {
              skipped++;
              continue;
            }
            await LabTest.create(testPayload);
            created++;
          }
        } catch (e: any) {
          if (e.code === 11000) {
            if (forceUpdate) {
              updated++;
            } else {
              skipped++;
            }
          } else {
            errors.push(`${testName}: ${e.message}`);
          }
        }
      }

      // Invalidate test cache
      await redisService.del(`lab:tests:${hospitalId}`);

      res.json({
        message: "Bulk import complete (Legacy format)",
        created,
        updated,
        skipped,
        errors,
      });
    }
  } catch (error: any) {
    console.error("Bulk Import Tests Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
