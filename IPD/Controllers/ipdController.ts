import { Request, Response } from "express";
import mongoose, { Schema } from "mongoose";
const { isValidObjectId } = mongoose;
import BedOccupancy from "../Models/BedOccupancy.js";
import IPDAdmission from "../Models/IPDAdmission.js";
import Bed from "../Models/Bed.js";
import Room from "../Models/Room.js";
import StaffProfile from "../../Staff/Models/StaffProfile.js";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import User from "../../Auth/Models/User.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import ApiError from "../../utils/ApiError.js";
import redisService from "../../config/redis.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Transaction from "../../Admin/Models/Transaction.js";
import { generateTransactionId, generateReceiptNumber } from "../../utils/idGenerator.js";

const generateId = (prefix: string) => {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${timestamp}-${random}`;
};

export const invalidateIPDCache = async (
  hospitalId: string,
  bedIds?: string | string[],
) => {
  const promises = [
    redisService.delPattern(`ipd:admissions:active:${hospitalId}*`),
    redisService.del(`nurse:stats:${hospitalId}`),
    redisService.delPattern(`ipd:beds:${hospitalId}*`),
  ];

  if (bedIds) {
    const ids = Array.isArray(bedIds) ? bedIds : [bedIds];
    ids.forEach((id) => {
      promises.push(redisService.del(`ipd:bed:details:${id}`));
    });
  }

  await Promise.all(promises);
};

export const initiateAdmission = asyncHandler(
  async (req: Request, res: Response) => {
    const start = Date.now();
    // 🚀 STEP 0: Pre-load dynamic models & resolve hospital context
    const AppointmentModel = (await import("../../Appointment/Models/Appointment.js")).default;
    const IPDAdvancePayment = (await import("../Models/IPDAdvancePayment.js")).default;

    const {
      patientId,
      doctorId,
      bedId,
      admissionType,
      diet,
      clinicalNotes,
      reason,
      vitals,
      amount,
      paymentMethod,
      paymentStatus,
    } = req.body;

    let hospital = (req as any).user?.hospital;
    if (!hospital) throw new ApiError(400, "Hospital context required for admission");

    const hospitalDoc = await Hospital.findById(hospital).lean();
    if (!hospitalDoc) throw new ApiError(404, "Hospital not found");

    // 🚀 STEP 1: Resolve Patient & Doctor IDs outside transaction
    let resolvedPatientId = patientId;
    const profileAsPatient = await PatientProfile.findById(patientId).lean();
    if (profileAsPatient) {
      resolvedPatientId = profileAsPatient.user;
    }

    let resolvedDoctorProfileId = doctorId;
    const profileAsDoctor = await DoctorProfile.findOne({
      $or: [
        { _id: isValidObjectId(doctorId) ? doctorId : null },
        { user: isValidObjectId(doctorId) ? doctorId : null },
      ],
    }).lean();

    if (profileAsDoctor) {
      resolvedDoctorProfileId = profileAsDoctor._id;
    } else if (!isValidObjectId(doctorId)) {
      throw new ApiError(400, "Invalid Doctor ID provided");
    }

    // 🚀 STEP 2: Generate IDs outside transaction
    // This removes the lock contention on HospitalCounter during the main transaction
    let admissionId = await generateTransactionId(hospital, hospitalDoc.name, "IPD");
    let advanceReceiptNumber: string | undefined;
    
    const isPaid = paymentStatus && paymentStatus.toLowerCase() === "paid";
    if (isPaid && amount > 0) {
      advanceReceiptNumber = await generateReceiptNumber(hospital, "IPD");
    }

    // Check for associated appointment
    const foundAppointment = await AppointmentModel.findOne({
      patient: resolvedPatientId,
      hospital: hospital,
      type: "IPD",
      status: { $ne: "cancelled" },
    }).sort({ createdAt: -1 });

    if (foundAppointment) {
      // Prioritize appointmentId (the professional HOR-xxxx ID) over the timestamp-based admissionId
      const idToReuse = foundAppointment.appointmentId || foundAppointment.admissionId;
      
      if (idToReuse) {
        const isIdTaken = await IPDAdmission.findOne({
          admissionId: idToReuse,
        }).lean();

        if (!isIdTaken) {
          admissionId = idToReuse as string;
        } else {
          foundAppointment.admissionId = admissionId;
        }
      }
    }

    // Check if the appointment already has a completed payment to avoid double billing
    let alreadyPaid = false;
    if (foundAppointment && isPaid) {
      const existingTx = await Transaction.findOne({
        referenceId: foundAppointment._id,
        status: "completed"
      }).lean();
      
      if (existingTx) {
        alreadyPaid = true;
        advanceReceiptNumber = existingTx.receiptNumber;
        console.log(`[IPD Admission] Reusing existing transaction ${existingTx.transactionId} for admission ${admissionId}`);
      }
    }

    // ✅ VITALS SYNC: If no vitals provided, try to fetch from existing IPD appointment
    let finalVitals = vitals;
    if (!finalVitals || Object.keys(finalVitals).length === 0) {
      const pendingApp = await (AppointmentModel.findOne({
        patient: resolvedPatientId,
        type: "IPD",
        status: { $in: ["Booked", "confirmed", "scheduled", "Booked Online"] }
      }) as any).unscoped().sort({ date: -1 });

      if (pendingApp?.vitals) {
        finalVitals = pendingApp.vitals;
      }
    }

    // 🚀 STEP 3: Execute Atomic Transaction
    const session = await mongoose.startSession();
    let result: any = {};

    try {
      await session.withTransaction(async () => {
        // A. Check for existing active admission
        const existingAdmission = await IPDAdmission.findOne({
          patient: resolvedPatientId, // FIX: Use resolvedPatientId (User ID) instead of patientId (could be profile ID)
          hospital: hospital,
          status: "Active",
        }).session(session);

        if (existingAdmission) {
          const existingOccupancy: any = await BedOccupancy.findOne({
            admission: existingAdmission._id,
            endDate: null,
          }).session(session);

          let bedInfo = "";
          if (existingOccupancy && existingOccupancy.bed) {
            const foundBed = await Bed.findOne({ _id: existingOccupancy.bed, hospital }).select("bedId").session(session);
            if (foundBed) bedInfo = ` (Bed: ${foundBed.bedId})`;
          }
          throw new ApiError(400, `Patient already has an active admission${bedInfo}. Please discharge first.`);
        }

        // B. Atomic Bed status update
        const bed = await Bed.findOne({ _id: bedId, hospital }).session(session);
        if (!bed) throw new ApiError(404, "Bed not found");
        if (bed.status !== "Vacant") throw new ApiError(400, "Bed is not vacant");

        const bedUpdateResult = await Bed.updateOne(
          { _id: bedId, hospital, status: "Vacant" },
          { $set: { status: "Occupied" } },
        ).session(session);

        if (bedUpdateResult.matchedCount === 0) {
          throw new ApiError(400, "Bed was just occupied by another admission. Please refresh.");
        }

        // C. Close stray occupancies for this bed
        await BedOccupancy.updateMany(
          { bed: bedId, endDate: { $exists: false } },
          { $set: { endDate: new Date() } },
        ).session(session);

        // D. Create Admission & Occupancy
        const admission = new IPDAdmission({
          admissionId,
          patient: resolvedPatientId,
          globalPatientId: resolvedPatientId,
          primaryDoctor: resolvedDoctorProfileId,
          admissionType,
          diet,
          clinicalNotes,
          reason,
          vitals: finalVitals,
          hospital,
          status: "Active",
          amount: amount || 0,
          paymentMethod: paymentMethod || "cash",
          paymentStatus: paymentStatus || "pending",
        });
        await admission.save({ session });

        const occupancy = new BedOccupancy({
          bed: bedId,
          admission: admission._id,
          hospital,
          startDate: new Date(),
          dailyRateAtTime: bed.pricePerDay || 0,
          halfDayRateAtTime: bed.pricePerHalfDay || (bed.pricePerDay ? Math.round(bed.pricePerDay / 2) : 0),
          hourlyRateAtTime: bed.pricePerHour || (bed.pricePerDay ? Math.round(bed.pricePerDay / 24) : 0),
        });
        await occupancy.save({ session });

        // E. Handle Advance Payment (Skip if already paid via Appointment)
        if (isPaid && amount > 0 && !alreadyPaid) {
          admission.advancePaid = (admission.advancePaid || 0) + Number(amount);
          await admission.save({ session });

          await IPDAdvancePayment.create([{
            patient: resolvedPatientId,
            globalPatientId: resolvedPatientId,
            admission: admission._id,
            hospital,
            amount: Number(amount),
            mode: paymentMethod === "upi" ? "UPI" : paymentMethod === "card" ? "Card" : "Cash",
            transactionType: "Advance",
            reference: advanceReceiptNumber,
            date: new Date(),
            receivedBy: (req as any).user._id,
          }], { session });

          await Transaction.create([{
            user: resolvedPatientId,
            userModel: "Patient",
            hospital,
            amount: Number(amount),
            type: "ipd_advance",
            status: "completed",
            referenceId: admission._id,
            transactionId: admissionId,
            receiptNumber: advanceReceiptNumber,
            date: new Date(),
            paymentMode: paymentMethod || "cash",
            paymentDetails: paymentMethod === "mixed" && req.body.paymentDetails ? {
              cash: Number(req.body.paymentDetails.cash) || 0,
              upi: Number(req.body.paymentDetails.upi) || 0,
              card: Number(req.body.paymentDetails.card) || 0,
            } : {
              cash: paymentMethod === "cash" ? Number(amount) : 0,
              upi: paymentMethod === "upi" ? Number(amount) : 0,
              card: paymentMethod === "card" ? Number(amount) : 0,
            },
          }], { session });
        } else if (alreadyPaid) {
          // If already paid via appointment, update admission record and ensure IPDAdvancePayment is recorded
          admission.advancePaid = (admission.advancePaid || 0) + Number(amount);
          await admission.save({ session });

          const existingAdv = await IPDAdvancePayment.findOne({ admission: admission._id }).session(session);
          if (!existingAdv && Number(amount) > 0) {
            const rawMethod = paymentMethod || foundAppointment?.payment?.paymentMethod || "cash";
            const advMode = rawMethod.toLowerCase() === "upi" ? "UPI" : rawMethod.toLowerCase() === "card" ? "Card" : rawMethod.toLowerCase() === "mixed" ? "Mixed" : "Cash";
            const receiptToUse = advanceReceiptNumber || foundAppointment?.payment?.receiptNumber || admissionId;

            await IPDAdvancePayment.create([{
              patient: resolvedPatientId,
              globalPatientId: resolvedPatientId,
              admission: admission._id,
              hospital,
              amount: Number(amount),
              mode: advMode,
              paymentDetails: (paymentMethod === "mixed" && req.body.paymentDetails) ? req.body.paymentDetails : foundAppointment?.payment?.paymentDetails,
              transactionType: "Advance",
              reference: receiptToUse,
              transactionId: admissionId,
              receiptNumber: receiptToUse,
              date: foundAppointment?.createdAt || new Date(),
              receivedBy: (req as any).user?._id,
            }], { session });
          }

          // Ensure the existing appointment transaction has admissionId recorded
          if (foundAppointment) {
            await Transaction.updateMany(
              { referenceId: foundAppointment._id, type: "ipd_advance", hospital },
              { $set: { transactionId: admissionId, receiptNumber: advanceReceiptNumber || foundAppointment?.payment?.receiptNumber || admissionId } }
            ).session(session);
          }
        }

        // F. Link Appointment
        if (foundAppointment) {
          if (!foundAppointment.payment) foundAppointment.payment = {};
          foundAppointment.payment.amount = Number(amount) || 0;
          foundAppointment.payment.paymentMethod = paymentMethod || "cash";
          foundAppointment.payment.paymentStatus = (paymentStatus as any) || "pending";
          foundAppointment.amount = Number(amount) || 0;
          foundAppointment.paymentStatus = (paymentStatus as any) || "pending";
          
          // Mark as admitted
          foundAppointment.status = "admitted";
          foundAppointment.admissionId = admission._id.toString();
          
          foundAppointment.markModified("payment");
          await foundAppointment.save({ session });
        }

        result = { admission, occupancy, bed };
      });

      // 🚀 STEP 4: Post-Transaction Logic
      await invalidateIPDCache(hospital, bedId);

      const responseOccupancy = result.occupancy.toObject ? result.occupancy.toObject() : { ...result.occupancy };
      responseOccupancy.bed = result.bed;

      res.status(201).json({ 
        admission: result.admission, 
        occupancy: responseOccupancy,
        receiptNumber: advanceReceiptNumber || result.admission.receiptNumber 
      });
    } catch (error) {
      console.error(`[IPD Admission Critical Error]`, error);
      throw error; // asyncHandler will catch and send proper 500/400
    } finally {
      session.endSession();
      console.log(`[IPD Admission] Total duration: ${Date.now() - start}ms`);
    }
  },
);


export const transferBed = asyncHandler(async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params; // Admission ID
    const { newBedId } = req.body;
    const hospital = (req as any).user.hospital;

    const admission = await IPDAdmission.findOne({
      admissionId: id,
      hospital,
    }).session(session);
    if (!admission) throw new ApiError(404, "Admission not found");
    if (admission.status !== "Active")
      throw new ApiError(400, "Admission is not active");

    // Clear transfer request flag
    admission.transferRequested = false;
    admission.transferInstructions = undefined;
    await admission.save({ session });

    // 1. Find active occupancy and close it
    const currentOccupancy = await BedOccupancy.findOne({
      admission: admission._id,
      endDate: { $exists: false },
    }).session(session);

    if (!currentOccupancy)
      throw new ApiError(404, "Current occupancy record not found");

    const oldBedId = currentOccupancy.bed;
    currentOccupancy.endDate = new Date();
    await currentOccupancy.save({ session });

    // 2. Set old bed to Vacant (or Cleaning) in Bed collection
    await Bed.updateOne(
      { _id: oldBedId, hospital },
      { $set: { status: "Cleaning" } },
    ).session(session);

    // 3. Verify new Bed in Bed collection
    const newBed = await Bed.findOne({ _id: newBedId, hospital }).session(
      session,
    );

    if (!newBed) throw new ApiError(404, "New bed not found");
    if (newBed.status !== "Vacant")
      throw new ApiError(400, "New bed is not vacant");

    // 4. Create new occupancy
    const newOccupancy = new BedOccupancy({
      bed: newBedId,
      admission: admission._id,
      hospital,
      startDate: new Date(),
      dailyRateAtTime: newBed.pricePerDay || 0,
      halfDayRateAtTime: newBed.pricePerHalfDay || (newBed.pricePerDay ? Math.round(newBed.pricePerDay / 2) : 0),
      hourlyRateAtTime: newBed.pricePerHour || (newBed.pricePerDay ? Math.round(newBed.pricePerDay / 24) : 0),
    });
    await newOccupancy.save({ session });

    // 5. Update new Bed status in Bed collection
    await Bed.updateOne(
      { _id: newBedId, hospital },
      { $set: { status: "Occupied" } },
    ).session(session);

    await session.commitTransaction();

    // Invalidate Cache
    await invalidateIPDCache(hospital, [oldBedId.toString(), newBedId]);

    // ✅ REAL-TIME SYNC: Notify all users in the hospital about the bed change
    if ((req as any).io) {
      (req as any).io.to(`hospital_${hospital}`).emit("ipd:bed_updated", {
        type: "transfer",
        admissionId: admission.admissionId,
        oldBedId: oldBedId.toString(),
        newBedId: newBedId,
      });
      console.log(
        `📡 [WS] Emitted ipd:bed_updated (transfer) to hospital_${hospital}`,
      );
    }

    res.json({ message: "Transfer successful", newOccupancy });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    session.endSession();
  }
});

export const dischargePatient = asyncHandler(
  async (req: Request, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { id } = req.params; // Admission ID
      const hospital = (req as any).user.hospital;

      const admission = await IPDAdmission.findOne({
        admissionId: id,
        hospital,
      }).session(session);
      if (!admission) throw new ApiError(404, "Admission not found");
      if (admission.status !== "Active")
        throw new ApiError(400, "Admission is already discharged");

      // 1. Remove active occupancy as requested by user
      const currentOccupancy = await BedOccupancy.findOne({
        admission: admission._id,
        $or: [{ endDate: { $exists: false } }, { endDate: null }],
      }).session(session);

      if (currentOccupancy) {
        // 1. Delete instead of end
        await BedOccupancy.deleteOne({ _id: currentOccupancy._id }).session(
          session,
        );

        // 2. Set bed to Cleaning in Bed collection (independent of hospital filter for safety)
        await Bed.updateOne(
          { _id: currentOccupancy.bed },
          { $set: { status: "Cleaning" } },
        ).session(session);
      }

      // 3. Update Admission status
      admission.status = "Discharged";
      admission.dischargeDate = admission.dischargeDate || new Date();
      await admission.save({ session });

      await session.commitTransaction();

      // Invalidate Cache
      const bedIdToClear = currentOccupancy
        ? currentOccupancy.bed.toString()
        : undefined;
      await invalidateIPDCache(hospital, bedIdToClear);

      res.json({ message: "Patient discharged successfully", admission });
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      session.endSession();
    }
  },
);

export const getActiveAdmissions = asyncHandler(
  async (req: any, res: Response) => {
    let hospital = (req as any).user.hospital;
    let { department, doctorId } = req.query;

    // 🚀 DOCTOR SECURITY: Force doctors to see ONLY their own patients
    const userRole = (req.user?.role || "").trim().toLowerCase();
    const requesterId = (req.user?._id || req.user?.id)?.toString();

    // 🚀 [NEW CODE 21:14] Debug Start
    console.log(`[IPD Registry] Request by ${req.user?._id} (${userRole})`);

    // 1. Resolve the actual DoctorProfile ID
    let resolvedDoctorProfileId: any = null;

    if (userRole === "doctor") {
      const doctorProfile = await DoctorProfile.findOne({
        user: req.user._id,
      }).select("_id");
      if (doctorProfile) {
        resolvedDoctorProfileId = doctorProfile._id;
        console.log(
          `[Doctor Security] Request by Doctor: ${requesterId} -> Profile: ${resolvedDoctorProfileId}`,
        );
      } else {
        console.warn(
          `[Doctor Security] DENIED: No DoctorProfile for user ${requesterId}`,
        );
        return res.json([]); // Return nothing if role is doctor but no profile exists
      }
    } else if (
      doctorId &&
      doctorId !== "all" &&
      doctorId !== "undefined" &&
      doctorId !== "null"
    ) {
      // For Nurses/Admin/Helpdesk, they can pass a doctorId in query
      const targetProfile = await DoctorProfile.findOne({
        $or: [
          { _id: isValidObjectId(doctorId) ? doctorId : null },
          { user: isValidObjectId(doctorId) ? doctorId : null },
        ],
      }).select("_id");
      resolvedDoctorProfileId =
        targetProfile?._id || (isValidObjectId(doctorId) ? doctorId : null);
    }

    // Resilient department & hospital identification for nurses/staff
    let staffProfile: any = null;
    if (userRole === "nurse" || userRole === "staff") {
      staffProfile = await StaffProfile.findOne({ user: req.user?._id });
      if (staffProfile) {
        if (!hospital) hospital = staffProfile.hospital;
        if (req.user?.role === "nurse" && staffProfile.department) {
          department = staffProfile.department;
        }
      }

      if (userRole === "nurse" && !department && !req.query.department) {
        return res.json([]); // STRICT SECURITY for nurses
      }
    }

    if (!hospital) {
      return res
        .status(400)
        .json({ message: "Hospital identification failed" });
    }

    // 🚀 CACHE BYPASSED: Frequency of context changes (Vishnu/Divya) causing leakage.
    // Fetching fresh from DB to guarantee isolation.

    // ... (doctor profile resolution)

    // Define dynamic status based on user role
    const isClinicalStaff = userRole === "doctor" || userRole === "nurse";
    const statusFilter = isClinicalStaff
      ? "Active"
      : { $in: ["Active", "Discharge Initiated"] };

    const query: any = {
      hospital,
      status: statusFilter,
    };

    // Apply the resolved doctor filter
    if (resolvedDoctorProfileId) {
      query.primaryDoctor = resolvedDoctorProfileId;
    } else if (userRole === "doctor") {
      return res.json([]);
    }

    // Process Department Filter (Supports comma-separated list from frontend)
    let filterDepts: string[] = [];
    if (department) {
      filterDepts = String(department)
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
    }

    console.log(
      `[IPD Registry] Fetching for Hospital: ${hospital} | Query:`,
      JSON.stringify(query),
    );

    const admissions = await IPDAdmission.find(query)
      .populate({ path: "patient", select: "name mobile gender dateOfBirth role" })
      .populate({
        path: "primaryDoctor",
        populate: { path: "user", select: "name" },
      })
      .sort({ updatedAt: -1 })
      .lean();

    const AppointmentModel = (await import("../../Appointment/Models/Appointment.js")).default;

    // ✅ PENDING ADMISSION SYNC: If we are looking for active patients, also include those booked but not yet admitted
    let pendingAdmissions: any[] = [];
    if (userRole === "doctor" || userRole === "nurse" || userRole === "helpdesk" || userRole === "masterhelpdesk") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const pendingAppointments = await (AppointmentModel.find({
        hospital,
        type: "IPD",
        status: { $in: ["Booked", "confirmed", "scheduled", "Booked Online"] },
        date: { $gte: today }
      }) as any).unscoped()
        .populate({ path: "patient", select: "name mobile gender dateOfBirth role" })
        .populate({ path: "doctor", populate: { path: "user", select: "name" } })
        .lean();

      // Filter out those that already have an active admission
      const activePatientIds = new Set(admissions.map(a => (a.patient?._id || a.patient)?.toString()));

      pendingAdmissions = pendingAppointments
        .filter(app => !activePatientIds.has((app.patient?._id || app.patient)?.toString()))
        .map(app => ({
          _id: app._id,
          admissionId: "PENDING",
          patient: app.patient,
          primaryDoctor: app.doctor,
          status: "Pending",
          reason: app.reason || "Scheduled IPD",
          createdAt: app.createdAt,
          isPending: true,
          vitals: app.vitals,
          appointmentId: app._id
        }));
    }

    const allAdmissions = [...admissions, ...pendingAdmissions];
    if (!allAdmissions.length) return res.json([]);

    const realAdmissionIds = admissions.map(a => a._id);
    const patientIds = allAdmissions.map(a => a.patient?._id || a.patient);

    // 🚀 BULK FETCH 1: Active Occupancies for these admissions
    const occupancyResults = await BedOccupancy.find({
      admission: { $in: realAdmissionIds },
      $or: [{ endDate: { $exists: false } }, { endDate: null }]
    }).lean();

    const occupancyMap = new Map();
    occupancyResults.forEach(occ => occupancyMap.set(occ.admission.toString(), occ));

    // 🚀 BULK FETCH 2: Patient Profiles for these patients
    const patientProfileResults = await PatientProfile.find({
      user: { $in: patientIds.filter(Boolean) }
    }).lean();

    const profileMap = new Map();
    patientProfileResults.forEach(p => profileMap.set(p.user.toString(), p));

    // 🚀 BULK FETCH 3: Fetch all Beds for this hospital once (for O(1) lookup)
    const beds = await Bed.find({ hospital }).lean();
    const bedMap = new Map();
    beds.forEach((b: any) => {
      bedMap.set(b._id.toString(), b);
    });

    const results = allAdmissions.map((adm: any) => {
       const patientIdStr = (adm.patient?._id || adm.patient)?.toString();
       const patientProfile = profileMap.get(patientIdStr);
       const occupancy = occupancyMap.get(adm._id.toString());
       
       let activePatient = adm.patient;
       
       // Handle cases where patient data might be embedded or needs hydration from profile
       const patientData = {
          ...(activePatient && typeof activePatient === 'object' ? activePatient : {}),
          mrn: patientProfile?.mrn || "N/A",
          gender: activePatient?.gender || patientProfile?.gender,
          dateOfBirth: activePatient?.dateOfBirth || patientProfile?.dob || (patientProfile as any)?.dateOfBirth,
       };

       // Resolve Bed Details from map
       let bedDetails: any = { bedId: "N/A", status: "Unknown", room: "No Room Assigned" };
       if (occupancy && occupancy.bed) {
          const foundBed = bedMap.get(occupancy.bed.toString());
          if (foundBed) bedDetails = foundBed;
       }

       // Filter by department if provided (now faster in memory)
       if (department) {
          const depts = String(department).split(",").map(d => d.trim().toLowerCase()).filter(Boolean);
          if (depts.length > 0) {
             const matchesType = bedDetails.type && depts.some(d => bedDetails.type.toLowerCase().includes(d));
             const matchesDept = bedDetails.department && depts.some(d => bedDetails.department.toLowerCase().includes(d));
             if (!matchesType && !matchesDept) return null;
          }
       }

       return {
          ...adm,
          patient: patientData,
          patientProfile: patientProfile,
          bed: bedDetails,
          vitals: adm.vitals || null
       };
    }).filter(r => r !== null);

    res.json(results);
  },
);

export const getDischargedAdmissions = asyncHandler(
  async (req: any, res: Response) => {
    let hospital = (req as any).user.hospital;
    
    if (!hospital) {
      return res
        .status(400)
        .json({ message: "Hospital identification failed" });
    }

    const query: any = {
      hospital,
      status: "Discharged",
    };

    console.log(
      `[IPD Registry] Fetching Discharged for Hospital: ${hospital} | Query:`,
      JSON.stringify(query),
    );

    const admissions = await IPDAdmission.find(query)
      .populate({ path: "patient", select: "name mobile gender dateOfBirth role" })
      .populate({
        path: "primaryDoctor",
        populate: { path: "user", select: "name" },
      })
      .sort({ updatedAt: -1 })
      .lean();

    if (!admissions.length) return res.json([]);

    const realAdmissionIds = admissions.map(a => a._id);
    const patientIds = admissions.map(a => a.patient?._id || a.patient);

    // 🚀 BULK FETCH 1: Occupancies for these admissions
    // For discharged patients, we might not have an active occupancy, so we get all and pick the latest
    const occupancyResults = await BedOccupancy.find({
      admission: { $in: realAdmissionIds }
    }).sort({ startDate: -1 }).lean();

    const occupancyMap = new Map();
    // Since sorted by startDate descending, the first one encountered per admission is the most recent
    occupancyResults.forEach(occ => {
      const admIdStr = occ.admission.toString();
      if (!occupancyMap.has(admIdStr)) {
        occupancyMap.set(admIdStr, occ);
      }
    });

    // 🚀 BULK FETCH 2: Patient Profiles for these patients
    const patientProfileResults = await PatientProfile.find({
      user: { $in: patientIds.filter(Boolean) }
    }).lean();

    const profileMap = new Map();
    patientProfileResults.forEach(p => profileMap.set(p.user.toString(), p));

    // 🚀 BULK FETCH 3: Fetch all Beds for this hospital once (for O(1) lookup)
    const beds = await Bed.find({ hospital }).lean();
    const bedMap = new Map();
    beds.forEach((b: any) => {
      bedMap.set(b._id.toString(), b);
    });

    const results = admissions.map((adm: any) => {
       const patientIdStr = (adm.patient?._id || adm.patient)?.toString();
       const patientProfile = profileMap.get(patientIdStr);
       const occupancy = occupancyMap.get(adm._id.toString());
       
       let activePatient = adm.patient;
       
       // Handle cases where patient data might be embedded or needs hydration from profile
       const patientData = {
          ...(activePatient && typeof activePatient === 'object' ? activePatient : {}),
          mrn: patientProfile?.mrn || "N/A",
          gender: activePatient?.gender || patientProfile?.gender,
          dateOfBirth: activePatient?.dateOfBirth || patientProfile?.dob || (patientProfile as any)?.dateOfBirth,
       };

       // Resolve Bed Details from map
       let bedDetails: any = { bedId: "N/A", status: "Unknown", room: "No Room Assigned" };
       if (occupancy && occupancy.bed) {
          const foundBed = bedMap.get(occupancy.bed.toString());
          if (foundBed) bedDetails = foundBed;
       }

       return {
          ...adm,
          patient: patientData,
          patientProfile: patientProfile,
          bed: bedDetails,
          vitals: adm.vitals || null
       };
    });

    res.json(results);
  },
);

export const quickUpdateBedStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const hospital = (req as any).user.hospital;

    // Validate status transition rules
    const allowedTransitions: { [key: string]: string[] } = {
      Cleaning: ["Vacant"],
      Vacant: ["Occupied", "Blocked", "Cleaning"],
      Blocked: ["Vacant"],
      Occupied: ["Cleaning", "Vacant"],
    };

    const bed = await Bed.findOne({ _id: id, hospital });
    if (!bed) throw new ApiError(404, "Bed not found");

    const currentStatus = bed.status;

    // Check if transition is allowed
    if (!allowedTransitions[currentStatus]?.includes(status)) {
      throw new ApiError(
        400,
        `Cannot transition from ${currentStatus} to ${status}. Allowed transitions: ${allowedTransitions[currentStatus]?.join(", ") || "none"}`,
      );
    }

    // Update bed status
    bed.status = status;
    await bed.save();

    // If bed is moving to Vacant or Cleaning, ensure any active occupancy is closed
    if (status === "Vacant" || status === "Cleaning") {
      await BedOccupancy.updateMany(
        { bed: id, endDate: { $exists: false } },
        { $set: { endDate: new Date() } },
      );
    }

    // Invalidate Cache
    await invalidateIPDCache(hospital, id);

    res.json({
      message: "Bed status updated successfully",
      bed: {
        _id: bed._id,
        bedId: bed.bedId,
        status: bed.status,
        type: bed.type,
        floor: bed.floor,
        room: bed.room,
      },
    });
  },
);

export const requestDischarge = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params; // IPDAdmission _id
    const hospitalId = (req as any).user.hospital;

    const admission = await IPDAdmission.findOne({
      _id: id,
      hospital: hospitalId,
    }).populate("patient", "name");
    if (!admission) throw new ApiError(404, "Admission not found");

    admission.dischargeRequested = true;
    admission.dischargeRequestedAt = new Date();
    admission.dischargeRequestedBy =
      (req as any).user?._id || (req as any).user?.id;
    await admission.save();

    await invalidateIPDCache(hospitalId);

    // ✅ EMIT WebSocket: Notify Helpdesk about new request
    if ((req as any).io) {
      (req as any).io.to(`hospital_${hospitalId}`).emit("ipd:request_updated", {
        type: "discharge",
        admissionId: admission.admissionId,
        patientName: (admission.patient as any)?.name || "Inpatient",
        requestedBy: (req as any).user?.name,
        requestedAt: new Date(),
      });
      console.log(
        `📡 [WS] Emitted ipd:request_updated to hospital_${hospitalId}`,
      );
    }

    res.json({ message: "Discharge requested successfully", admission });
  },
);

export const requestTransfer = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params; // IPDAdmission _id
    const hospitalId = (req as any).user.hospital;

    const { roomType, room, bed, notes, targetBedId } = req.body;

    const admission = await IPDAdmission.findOne({
      _id: id,
      hospital: hospitalId,
    }).populate("patient", "name");
    if (!admission) throw new ApiError(404, "Admission not found");

    admission.transferRequested = true;
    admission.transferRequestedAt = new Date();
    admission.transferRequestedBy =
      (req as any).user?._id || (req as any).user?.id;
    admission.transferInstructions = {
      roomType,
      room,
      bed,
      notes,
      targetBedId,
    };
    await admission.save();

    await invalidateIPDCache(hospitalId);

    // ✅ REAL-TIME SYNC: Notify helpdesk about the new request
    if ((req as any).io) {
      (req as any).io.to(`hospital_${hospitalId}`).emit("ipd:request_updated", {
        type: "transfer",
        admissionId: admission.admissionId,
        requestedBy: (req as any).user?.name,
        requestedAt: new Date(),
      });
    }

    res.json({ message: "Transfer requested successfully", admission });
  },
);

export const getPendingRequests = asyncHandler(
  async (req: any, res: Response) => {
    const hospital = req.user.hospital;
    if (!hospital) throw new ApiError(400, "Hospital context required");

    const admissions = await IPDAdmission.find({
      hospital,
      $or: [{ dischargeRequested: true }, { transferRequested: true }],
    })
      .select(
        "admissionId dischargeRequested transferRequested dischargeRequestedAt dischargeRequestedBy transferRequestedAt transferRequestedBy patient transferInstructions",
      )
      .populate("dischargeRequestedBy", "name")
      .populate("transferRequestedBy", "name")
      .populate("patient", "name");

    const requestsRaw = await Promise.all(
      admissions.map(async (adm: any) => {
        const occupancy = await BedOccupancy.findOne({
          admission: adm._id,
          endDate: { $exists: false },
        });

        if (!occupancy || !occupancy.bed) return null;

        const results: any[] = [];
        const bedId = occupancy.bed.toString();

        if (adm.dischargeRequested) {
          results.push({
            bedId,
            admissionId: adm.admissionId,
            requestType: "discharge",
            requestedBy: adm.dischargeRequestedBy?.name || "Doctor",
            requestedAt: adm.dischargeRequestedAt || adm.updatedAt,
            patientName: adm.patient?.name,
          });
        }
        if (adm.transferRequested) {
          results.push({
            bedId,
            admissionId: adm.admissionId,
            requestType: "transfer",
            requestedBy: adm.transferRequestedBy?.name || "Doctor",
            requestedAt: adm.transferRequestedAt || adm.updatedAt,
            patientName: adm.patient?.name,
            instructions: adm.transferInstructions,
          });
        }
        return results;
      }),
    );

    const requests = requestsRaw.flat().filter(Boolean);

    res.json(requests);
  },
);

export const cancelDischargeRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const hospital = (req as any).user.hospital;

    const admission = await IPDAdmission.findOne({
      $or: [{ _id: isValidObjectId(id) ? id : null }, { admissionId: id }],
      hospital,
    });
    if (!admission) throw new ApiError(404, "Admission not found");

    admission.dischargeRequested = false;
    admission.dischargeRequestedAt = undefined;
    admission.dischargeRequestedBy = undefined;
    await admission.save();

    await invalidateIPDCache(hospital);

    // ✅ REAL-TIME SYNC: Update Helpdesk
    if ((req as any).io) {
      (req as any).io.to(`hospital_${hospital}`).emit("ipd:request_updated", {
        type: "discharge_cancelled",
        admissionId: admission.admissionId,
        patientName: (admission.patient as any)?.name,
      });
    }

    res.json({ message: "Discharge request cancelled", admission });
  },
);

export const cancelTransferRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const hospital = (req as any).user.hospital;

    const admission = await IPDAdmission.findOne({
      $or: [{ _id: isValidObjectId(id) ? id : null }, { admissionId: id }],
      hospital,
    });
    if (!admission) throw new ApiError(404, "Admission not found");

    admission.transferRequested = false;
    admission.transferRequestedAt = undefined;
    admission.transferRequestedBy = undefined;
    await admission.save();

    await invalidateIPDCache(hospital);

    // ✅ REAL-TIME SYNC: Update Helpdesk
    if ((req as any).io) {
      (req as any).io.to(`hospital_${hospital}`).emit("ipd:request_updated", {
        type: "transfer_cancelled",
        admissionId: admission.admissionId,
        patientName: (admission.patient as any)?.name,
      });
    }

    res.json({ message: "Transfer request cancelled", admission });
  },
);

export const updateAdmissionDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params; // Admission ID
    const { reason, clinicalNotes } = req.body;
    const hospital = (req as any).user.hospital;

    const admission = await IPDAdmission.findOne({
      $or: [{ _id: isValidObjectId(id) ? id : null }, { admissionId: id }],
      hospital,
    });

    if (!admission) throw new ApiError(404, "Admission not found");

    if (reason !== undefined) admission.reason = reason;
    if (clinicalNotes !== undefined) admission.clinicalNotes = clinicalNotes;

    await admission.save();

    await invalidateIPDCache(hospital);

    res.json({ message: "Admission details updated successfully", admission });
  },
);
