import mongoose from "mongoose";
import Appointment from "../../Appointment/Models/Appointment.js";
import MobileAppointment from "../../Appointment/Models/MobileAppointment.js";
import Transaction from "../../Admin/Models/Transaction.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import Patient from "../../Patient/Models/Patient.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import { resolvePatientIdentity } from "../../utils/identityResolver.js";
import ApiError from "../../utils/ApiError.js";
import bcrypt from "bcrypt";
import { generateTransactionId, generateReceiptNumber, generateMrn } from "../../utils/idGenerator.js";
import { createNotification } from "../../Notification/Controllers/notificationController.js";
import { Server } from "socket.io";
import User from "../../Auth/Models/User.js";

const calculateAgeFromDob = (dob: any) => {
  if (!dob) return "N/A";
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return "N/A";
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

class MasterHelpdeskService {
  async getDashboardStats(hospitalId?: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const appFilter: any = { date: { $gte: startOfToday, $lte: endOfToday } };
    const txFilter: any = { date: { $gte: startOfToday, $lte: endOfToday } };
    
    if (hospitalId) {
      appFilter.hospital = hospitalId;
      txFilter.hospital = hospitalId;
    }

    // Special filter for online appointments to support the frontend 7-day picker
    const onlineAppFilter = {
      ...appFilter,
      date: { 
        $gte: startOfToday, 
        $lte: new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000) 
      }
    };

    // Fetch from both Appointment and MobileAppointment
    const [offlineApps, onlineApps, transactions, transactionsAgg, activeIPD, totalPatients] = await Promise.all([
      (Appointment.find(appFilter) as any)
        .unscoped()
        .populate({ path: "patient", options: { unscoped: true } })
        .populate({ 
          path: "doctor", 
          options: { unscoped: true },
          populate: { path: "user", options: { unscoped: true } }
        })
        .populate({ path: "hospital", options: { unscoped: true } })
        .lean(),

      (MobileAppointment.find(onlineAppFilter) as any)
        .unscoped()
        .populate({
          path: "patient",
          options: { unscoped: true },
          populate: { path: "user", options: { unscoped: true } },
        })
        .populate({ 
          path: "doctor", 
          options: { unscoped: true },
          populate: { path: "user", options: { unscoped: true } }
        })
        .populate({ path: "hospital", options: { unscoped: true } })
        .lean(),

      (Transaction.find(txFilter) as any)
        .unscoped()
        .lean(),
      Transaction.aggregate([
        { 
          $match: { 
            ...txFilter, 
            hospital: hospitalId ? new mongoose.Types.ObjectId(hospitalId as string) : undefined,
            status: { $in: ["completed", "paid"] } 
          } 
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$amount" },
            onlineRevenue: {
              $sum: {
                $cond: [
                  { $in: [{ $toUpper: "$paymentMode" }, ["UPI", "CARD", "ONLINE", "NETBANKING", "RAZORPAY"]] },
                  "$amount",
                  0
                ]
              }
            },
            offlineRevenue: {
              $sum: {
                $cond: [
                  { $in: [{ $toUpper: "$paymentMode" }, ["CASH", "OFFLINE"]] },
                  "$amount",
                  0
                ]
              }
            },
            onlineCount: {
                $sum: {
                  $cond: [
                    { $in: [{ $toUpper: "$paymentMode" }, ["UPI", "CARD", "ONLINE", "NETBANKING", "RAZORPAY"]] },
                    1,
                    0
                  ]
                }
              },
              offlineCount: {
                $sum: {
                  $cond: [
                    { $in: [{ $toUpper: "$paymentMode" }, ["CASH", "OFFLINE"]] },
                    1,
                    0
                  ]
                }
              },
          }
        }
      ]),
      (IPDAdmission.countDocuments({ status: "Active", ...(hospitalId && { hospital: hospitalId }) }) as any).unscoped(),
      (Patient.countDocuments({ role: "patient", ...(hospitalId && { hospitals: hospitalId }) }) as any).unscoped(),
    ]);

    const txStats = transactionsAgg[0] || { totalRevenue: 0, onlineRevenue: 0, offlineRevenue: 0, onlineCount: 0, offlineCount: 0 };

    const allAppointments = [
      ...offlineApps.map((a: any) => ({ 
        ...a, 
        source: "offline",
        // Case-insensitive check for regular appointments marked as online
        isOnline: String(a.type).toLowerCase() === "online" || String(a.visitType).toLowerCase() === "online" 
      })),
      ...onlineApps.map((a: any) => ({
        ...a,
        source: "online",
        isOnline: true, // All MobileAppointments are online (mobile-sourced), regardless of mode
        // Map MobileAppointment patient (which is a Profile) to the User object for consistency
        patient: a.patient?.user || a.patient,
        type: a.appointmentType || "Consultation",
      })),
    ];

    const todayAppointmentsOnly = allAppointments.filter(a => 
      new Date(a.date).toDateString() === startOfToday.toDateString()
    );

    const stats = {
      todayAppointments: todayAppointmentsOnly.length,
      confirmed: todayAppointmentsOnly.filter(
        (a) => a.status?.toLowerCase() === "confirmed" || a.status === "Confirmed"
      ).length,
      pending: todayAppointmentsOnly.filter((a) =>
        ["pending", "booked", "Booked"].includes(a.status)
      ).length,
      completed: todayAppointmentsOnly.filter(
        (a) => a.status?.toLowerCase() === "completed" || a.status === "Completed"
      ).length,
      revenue: txStats.totalRevenue,
      onlineRevenue: txStats.onlineRevenue,
      offlineRevenue: txStats.offlineRevenue,
      onlineAppointments: txStats.onlineCount, // Sync with transaction-based online count
      offlineAppointments: txStats.offlineCount,
      activeIPD,
      totalPatients,
    };

    // ── Bulk Identity Resolution Optimization ──────────────────────────────
    const allPatientIds = allAppointments
      .map(app => app.patient?._id || app.patient)
      .filter(id => id && mongoose.Types.ObjectId.isValid(id));
    
    const globalPatients = await (Patient.find({ _id: { $in: allPatientIds } }) as any).unscoped();
    const userNameMap = new Map(globalPatients.map((p: any) => [p._id.toString(), p.name]));

    const formattedAppointments = await Promise.all(
      allAppointments.map(async (app: any) => {
        const patientObj = app.patient?.user || app.patient;
        const patientIdStr = patientObj?._id?.toString() || patientObj?.toString();
        
        // Use pre-fetched name if available to avoid resolvePatientIdentity calling DB
        const preFetchedName = userNameMap.get(patientIdStr);
        const patientName = preFetchedName && preFetchedName !== "Unknown" 
          ? preFetchedName 
          : await resolvePatientIdentity(patientObj?._id || patientObj, app);

        return {
          ...app,
          id: app._id,
          patientName,
          doctorName: app.doctor?.user?.name || app.doctor?.name || "",
          hospitalName: app.hospital?.name || "N/A",
          time: app.appointmentTime || app.startTime || "N/A",
          status: app.status,
          type: app.type || app.visitType || "OPD",
          amount: app.payment?.amount || app.consultationFee || app.amount || 0,
          paymentStatus: app.payment?.paymentStatus || app.paymentStatus || "",
          age: app.patientDetails?.age || patientObj?.age || "--",
          gender: app.patientDetails?.gender || patientObj?.gender || "--",
          source: app.source,
          isOnline: app.isOnline,
        };
      })
    );

    return { stats, appointments: formattedAppointments };
  }

  async getQueue(query: any, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const filter: any = {};
    const mobileFilter: any = {};
    
    if (query.status) {
      filter.status = query.status;
      // Map statuses for mobile appointments (which are Title Case)
      if (query.status === "pending" || query.status === "Booked") {
        mobileFilter.status = "Booked";
        filter.status = { $in: ["pending", "Booked"] };
      } else if (query.status === "confirmed" || query.status === "Confirmed") {
        mobileFilter.status = "Confirmed";
        filter.status = { $in: ["confirmed", "Confirmed"] };
      } else if (query.status === "completed" || query.status === "Completed") {
        mobileFilter.status = "Completed";
        filter.status = { $in: ["completed", "Completed"] };
      } else if (query.status === "cancelled" || query.status === "Cancelled") {
        mobileFilter.status = "Cancelled";
        filter.status = { $in: ["cancelled", "Cancelled"] };
      } else {
        mobileFilter.status = query.status;
        filter.status = query.status; // Ensure filter.status is also set
      }
    }

    if (query.hospital && mongoose.Types.ObjectId.isValid(query.hospital)) {
      const hId = new mongoose.Types.ObjectId(query.hospital);
      filter.hospital = hId;
      mobileFilter.hospital = hId;
    }

    if (query.doctorId && mongoose.Types.ObjectId.isValid(query.doctorId)) {
      const docId = new mongoose.Types.ObjectId(query.doctorId);
      filter.doctor = docId;
      mobileFilter.doctor = docId;
    }

    if (query.startDate || query.endDate) {
      filter.date = {};
      mobileFilter.date = {};
      if (query.startDate) {
        const start = new Date(String(query.startDate));
        if (!isNaN(start.getTime())) {
          start.setHours(0, 0, 0, 0);
          filter.date.$gte = start;
          mobileFilter.date.$gte = start;
        }
      }
      if (query.endDate) {
        const end = new Date(String(query.endDate));
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          filter.date.$lte = end;
          mobileFilter.date.$lte = end;
        }
      }
    }

    const [offlineTotal, onlineTotal] = await Promise.all([
      (Appointment.countDocuments(filter) as any).unscoped(),
      (MobileAppointment.countDocuments(mobileFilter) as any).unscoped(),
    ]);

    const total = offlineTotal + onlineTotal;

    const [offlineApps, onlineApps] = await Promise.all([
      (Appointment.find(filter) as any)
        .unscoped()
        .sort({ date: -1, createdAt: -1 })
        .populate({ path: "patient", options: { unscoped: true } })
        .populate({
          path: "doctor",
          options: { unscoped: true },
          populate: { path: "user", options: { unscoped: true } },
        })
        .populate({ path: "hospital", options: { unscoped: true } })
        .lean(),

      (MobileAppointment.find(mobileFilter) as any)
        .unscoped()
        .sort({ date: -1, createdAt: -1 })
        .populate({
          path: "patient",
          options: { unscoped: true },
          populate: { path: "user", options: { unscoped: true } },
        })
        .populate({
          path: "doctor",
          options: { unscoped: true },
          populate: { path: "user", options: { unscoped: true } },
        })
        .populate({ path: "hospital", options: { unscoped: true } })
        .lean(),

    ]);


    const allApps = [
      ...offlineApps.map((a: any) => ({ 
        ...a, 
        source: "offline",
        // Case-insensitive check for regular appointments flagged as online
        isOnline: String(a.type || "").toLowerCase() === "online" || String(a.visitType || "").toLowerCase() === "online"
      })),
      ...onlineApps.map((a: any) => ({
        ...a,
        source: "online",
        isOnline: true, // All MobileAppointments are online (mobile-sourced), regardless of mode field
        mrn: a.mrn || a.patient?.mrn, // Preserve MRN from profile before flattening
        patient: a.patient?.user || a.patient,
        type: a.appointmentType || "Consultation",
      })),
    ].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const paginatedApps = allApps.slice(skip, skip + limit);

    const formattedQueue = await Promise.all(
      paginatedApps.map(async (app: any) => {
        const patientObj = app.patient?.user || app.patient;
        return {
          ...app,
          id: app._id,
          patientName: await resolvePatientIdentity(patientObj?._id || patientObj, app),
          doctorName: app.doctor?.user?.name || app.doctor?.name || "",
          hospitalName: app.hospital?.name || "N/A",
          mrn: app.mrn || app.patient?.mrn || "N/A",
          age: app.patientDetails?.age || patientObj?.age || app.patient?.age || "--",
          gender: app.patientDetails?.gender || patientObj?.gender || app.patient?.gender || "--",
          startTime: app.startTime || app.appointmentTime || "N/A",
          amount: app.payment?.amount || app.consultationFee || app.amount || 0,
          paymentStatus: app.payment?.paymentStatus || app.paymentStatus || "",
        };
      })
    );

    return {
      data: formattedQueue,
      pagination: { 
        total, 
        page, 
        limit, 
        totalPages: Math.ceil(total / limit),
        onlineCount: onlineTotal,
        offlineCount: offlineTotal
      },
    };

  }

  async getTransactions(
    page: number,
    limit: number,
    hospitalId?: string,
    startDate?: string,
    endDate?: string,
    type?: string,
    search?: string,
    paymentMode?: string,
    doctorId?: string
  ) {
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (hospitalId) {
      filter.hospital = hospitalId;
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { transactionId: searchRegex },
        { receiptNumber: searchRegex },
        { invoiceNumber: searchRegex },
        { patientName: searchRegex },
        { phone: searchRegex },
        { mobile: searchRegex },
        { "referenceId.patientName": searchRegex },
        { "referenceId.admissionId": searchRegex },
      ];
    }

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          start.setUTCHours(0, 0, 0, 0);
          filter.date.$gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          end.setUTCHours(23, 59, 59, 999);
          filter.date.$lte = end;
        }
      }
    }

    if (type && type !== "all") {
      if (type.includes(",")) {
        filter.type = { $in: type.split(",").map(t => t.trim()) };
      } else {
        filter.type = type;
      }
    }

    if (paymentMode && paymentMode !== "all") {
      if (paymentMode === "online") {
        filter.paymentMode = { $in: ["upi", "card", "online", "netbanking", "razorpay", "UPI", "CARD", "ONLINE", "NETBANKING", "RAZORPAY"] };
      } else if (paymentMode === "offline") {
        filter.paymentMode = { $in: ["cash", "offline", "CASH", "OFFLINE"] };
      } else {
        filter.paymentMode = { $in: [paymentMode.toLowerCase(), paymentMode.toUpperCase()] };
      }
    }

    if (doctorId && doctorId !== "all" && mongoose.Types.ObjectId.isValid(doctorId)) {
        // Find appointment IDs for this doctor
        const docObjectId = new mongoose.Types.ObjectId(doctorId);
        const [offlineAppIds, onlineAppIds] = await Promise.all([
          (Appointment.find({ doctor: docObjectId }) as any).unscoped().distinct("_id"),
          (MobileAppointment.find({ doctor: docObjectId }) as any).unscoped().distinct("_id")
        ]);
        
        const combinedIds = [...offlineAppIds, ...onlineAppIds];
        filter.referenceId = { $in: combinedIds };
    }

    const statsFilter: any = {
      hospital: hospitalId ? new mongoose.Types.ObjectId(hospitalId) : undefined,
      status: { $in: ["completed", "paid"] }
    };
    if (filter.date) statsFilter.date = filter.date;
    if (filter.referenceId) statsFilter.referenceId = filter.referenceId;

    const [total, transactions, stats] = await Promise.all([
      (Transaction.countDocuments(filter) as any).unscoped(),
      (Transaction.find(filter) as any)
        .unscoped()
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: "hospital", options: { unscoped: true } })
        .populate({ path: "user", options: { unscoped: true } })
        .lean(),
      Transaction.aggregate([
        { 
          $match: { 
            ...statsFilter, 
            hospital: statsFilter.hospital ? new mongoose.Types.ObjectId(String(statsFilter.hospital)) : undefined
          } 
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$amount" },
            onlineCount: {
              $sum: {
                $cond: [
                  { $in: [{ $toUpper: "$paymentMode" }, ["UPI", "CARD", "ONLINE", "NETBANKING", "RAZORPAY"]] },
                  1,
                  0
                ]
              }
            },
            offlineCount: {
              $sum: {
                $cond: [
                  { $in: [{ $toUpper: "$paymentMode" }, ["CASH", "OFFLINE"]] },
                  1,
                  0
                ]
              }
            },
            onlineRevenue: {
              $sum: {
                $cond: [
                  { $in: [{ $toUpper: "$paymentMode" }, ["UPI", "CARD", "ONLINE", "NETBANKING", "RAZORPAY"]] },
                  "$amount",
                  0
                ]
              }
            },
            offlineRevenue: {
              $sum: {
                $cond: [
                  { $in: [{ $toUpper: "$paymentMode" }, ["CASH", "OFFLINE"]] },
                  "$amount",
                  0
                ]
              }
            },
            cashRevenue: {
              $sum: { $cond: [{ $eq: [{ $toUpper: "$paymentMode" }, "CASH"] }, "$amount", 0] }
            },
            upiRevenue: {
              $sum: { $cond: [{ $eq: [{ $toUpper: "$paymentMode" }, "UPI"] }, "$amount", 0] }
            },
            cardRevenue: {
              $sum: { $cond: [{ $eq: [{ $toUpper: "$paymentMode" }, "CARD"] }, "$amount", 0] }
            }
          }
        }
      ])
    ]);

    const statsData = stats[0] || {
      totalRevenue: 0,
      onlineCount: 0,
      offlineCount: 0,
      onlineRevenue: 0,
      offlineRevenue: 0,
      cashRevenue: 0,
      upiRevenue: 0,
      cardRevenue: 0
    };

    const formattedTransactions = await Promise.all(
      transactions.map(async (t: any) => {
        // Fetch reference data for appointments to get clinical details and doctor names
        let referenceData = null;
        if (t.referenceId && (t.type === 'appointment_booking' || t.type === 'ipd_advance' || t.type === 'opd' || t.type === 'opd_consultation' || t.type === 'online_booking')) {
          // 1. Try finding in offline Appointment model
          referenceData = await (Appointment.findById(t.referenceId) as any)
            .unscoped()
            .populate({
              path: 'patient',
              options: { unscoped: true }
            })
            .populate({
              path: 'doctor',
              options: { unscoped: true },
              populate: { path: 'user', options: { unscoped: true } }
            })
            .lean();

          // 2. Fallback to MobileAppointment if not found (Online Bookings)
          if (!referenceData) {
            const mobileApp = await (MobileAppointment.findById(t.referenceId) as any)
              .unscoped()
              .populate({
                path: 'patient',
                options: { unscoped: true },
                populate: { path: 'user', options: { unscoped: true } }
              })
              .populate({
                path: 'doctor',
                options: { unscoped: true },
                populate: { path: 'user', options: { unscoped: true } }
              })
              .lean();
            
            if (mobileApp) {
              referenceData = {
                ...mobileApp,
                isOnline: true,
                patient: mobileApp.patient?.user || mobileApp.patient // Normalise for resolver
              };
            }
          }
        }

        return {
          id: t._id,
          _id: t._id,
          hospitalId: t.hospital?._id || t.hospital,
          patientName: await resolvePatientIdentity(t.user?._id || t.user, { 
            ...t, 
            referenceId: referenceData,
            source: (t.type === 'online_booking' || (referenceData as any)?.isOnline) ? 'online' : 'offline'
          }),
          hospitalName: t.hospital?.name || "N/A",
          amount: t.amount,
          type: t.type,
          status: t.status,
          date: t.date || t.createdAt,
          paymentMode: t.paymentMode,
          transactionId: t.transactionId,
          receiptNumber: t.receiptNumber,
          invoiceNumber: t.invoiceNumber,
          referenceId: referenceData || t.referenceId,
          // Attach clinical details for the frontend to use if referenceId is an appointment
          doctorName: (referenceData as any)?.doctor?.user?.name || (referenceData as any)?.doctor?.name || "N/A",
          patientNameResolved: (referenceData as any)?.patient?.name || (referenceData as any)?.patientName
        };
      })
    );

    return {
      data: formattedTransactions,
      stats: statsData,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getPatients(search: string, page: number, limit: number, hospitalId?: string) {
    const skip = (page - 1) * limit;
    let query: any = { role: "patient" };

    if (hospitalId) {
      query.hospitals = hospitalId;
    } else {
      // If no hospitalId is provided, we MUST return an empty set to prevent data leak,
      // unless the user is a super-admin (this check should ideally be in the controller)
      return { data: [], pagination: { total: 0, page, limit, totalPages: 0 } };
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
      ];
    }

    const [total, patients] = await Promise.all([
      (Patient.countDocuments(query) as any).unscoped(),
      (Patient.find(query) as any)
        .unscoped()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const patientIds = patients.map(p => p._id);
    const profiles = await (PatientProfile.find({ user: { $in: patientIds } }) as any).unscoped().lean();
    const profileMap = new Map<string, any>(profiles.map((pr: any) => [pr.user.toString(), pr]));

    const formattedPatients = await Promise.all(
      patients.map(async (p: any) => {
        const profile = profileMap.get(p._id.toString());
        const cleanName = await resolvePatientIdentity(p._id, p);
        return {
          ...p,
          id: p._id,
          name: cleanName,
          honorific: profile?.honorific || p.honorific || "",
          mrn: profile?.mrn || p.mrn || "N/A",
          gender: profile?.gender || p.gender || "N/A",
          age: profile?.age || p.age || (profile?.dob ? calculateAgeFromDob(profile.dob) : "N/A"),
          dob: profile?.dob || p.dob,
          profile: profile,
        };
      })
    );

    return {
      data: formattedPatients,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // Helper to generate User Credentials
  private generateCredentials(
    name: string,
    mobile: string,
    dob?: string | Date
  ) {
    const safeName = (name || "Patient").trim();
    const cleanName = safeName
      .split(" ")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const last4Mobile = (mobile || "0000").slice(-4);
    const username = `${cleanName}${last4Mobile}`;

    let password = `Pass${last4Mobile}@`;

    if (dob) {
      const d = new Date(dob as string);
      if (!isNaN(d.getTime())) {
        const day = d.getUTCDate().toString().padStart(2, "0");
        const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
        const year = d.getUTCFullYear();
        password = `${day}${month}${year}`;
      }
    }

    return { username, password };
  }

  async registerPatient(body: any, currentUser: any, hospitalIdFromReq?: string | mongoose.Types.ObjectId, io?: Server) {
    const session = await mongoose.startSession();
    session.startTransaction({
      readConcern: { level: "local" },
      writeConcern: { w: 1 },
    });

    try {
      const {
        name,
        mobile,
        email,
        gender,
        dob,
        address,
        age,
        honorific,
        height,
        weight,
        bloodPressure,
        bp,
        temperature,
        pulse,
        pulseRate,
        spO2,
        spo2,
        sugar,
        glucose,
        maritalStatus,
        bloodGroup,
        conditions,
        allergies,
        medications,
        medicalHistory,
        symptoms: symptomsInput,
        reason: reasonInput,
        notes,
        department,
        doctorId,
        visitType,
        appointmentDate,
        date: dateInput,
        appointmentTime,
        time,
        amount,
        paymentMethod,
        paymentStatus,
        emergencyContact,
        emergencyContactEmail,
        receiptNumber,
        guardianName,
        guardianRelation,
        guardianMobile,
        doctorReference,
      } = body;

      const date = dateInput || appointmentDate;

      const symptoms = (symptomsInput && symptomsInput.trim()) ? symptomsInput : notes;
      const reason = (reasonInput && reasonInput.trim()) ? reasonInput : notes;

      if (!name || !mobile) {
        throw new ApiError(400, "Patient name and mobile number are required for registration.");
      }

      const vitalsInput = body.vitals || {};

      const finalVitals = {
        height: vitalsInput.height || height,
        weight: vitalsInput.weight || weight,
        bloodPressure:
          vitalsInput.bloodPressure || vitalsInput.bp || bp || bloodPressure,
        temperature: vitalsInput.temperature || temperature,
        pulse: vitalsInput.pulse || vitalsInput.pulseRate || pulse || pulseRate,
        spO2: vitalsInput.spO2 || vitalsInput.spo2 || spO2 || spo2,
        glucose: vitalsInput.glucose || vitalsInput.sugar || glucose || sugar,
      };

      let allergiesString = "";
      if (allergies) {
        if (Array.isArray(allergies)) {
          allergiesString = allergies.filter((a: any) => a).join(", ");
        } else {
          allergiesString = String(allergies);
        }
      }

      const paymentInput = body.payment || {
        amount,
        paymentMethod,
        paymentStatus,
      };
      const visitTypeInput = body.visitType || body.type || "offline";

      let finalDoctorId = doctorId;
      let doctorProfile: any = null;
      if (doctorId) {
        doctorProfile = await (
          DoctorProfile.findById(doctorId) as any
        )
          .unscoped()
          .populate({ path: "user", options: { unscoped: true } });
        if (!doctorProfile) {
          doctorProfile = await (
            DoctorProfile.findOne({ user: doctorId }) as any
          )
            .unscoped()
            .populate({ path: "user", options: { unscoped: true } });
          if (doctorProfile) {
            finalDoctorId = doctorProfile._id;
          } else {
            throw new ApiError(
              404,
              "Doctor not found. Please provide a valid Doctor Profile ID or User ID.",
            );
          }
        } else {
          finalDoctorId = doctorProfile._id;
        }
      }

      const hospitalId = hospitalIdFromReq || currentUser.hospital;

      const nameRegex = { $regex: new RegExp(`^${name}$`, "i") };
      const searchCriteria: any = {
        name: nameRegex,
        $or: [{ mobile }],
      };
      if (email) {
        searchCriteria.$or.push({ email: email.toLowerCase() });
      }

      let user: any = await (Patient.findOne(searchCriteria) as any).unscoped();

      if (!user) {
        const placeholderCriteria: any = {
          name: {
            $in: [
              "Unknown Patient",
              "Unnamed Patient",
              "Unknown",
              "Placeholder",
            ],
          },
          $or: [{ mobile }],
        };
        if (email) {
          placeholderCriteria.$or.push({ email: email.toLowerCase() });
        }
        user = await (Patient.findOne(placeholderCriteria) as any).unscoped();
      }
      let patientProfile: any = null;
      if (user) {
        patientProfile = await (
          PatientProfile.findOne({
            user: user._id,
            hospital: hospitalId,
          }) as any
        ).unscoped();
      }

      let isNewUser = false;
      let generatedPassword = "";

      if (!user) {
        isNewUser = true;
        let passwordDob = dob;
        if (!passwordDob && age) {
          const d = new Date();
          d.setFullYear(d.getFullYear() - Number(age));
          passwordDob = d;
        }

        const { password } = this.generateCredentials(name, mobile, passwordDob);
        generatedPassword = password;
        const hashedPassword = await bcrypt.hash(password, 10);

        user = new Patient({
          name,
          honorific: honorific || undefined,
          mobile,
          email: email ? email.toLowerCase() : undefined,
          password: hashedPassword,
          role: "patient",
          hospitals: [hospitalId],
          status: "active",
          gender,
          age: age ? Number(age) : undefined,
          address,
        });
        await user.save({ session });
      } else {

        if (!user.hospitals) {
          user.hospitals = [];
        }

        const legacyHospital = (user as any).hospital;
        if (legacyHospital) {
          if (
            !user.hospitals.some(
              (h: any) => h.toString() === legacyHospital.toString(),
            )
          ) {
            user.hospitals.push(legacyHospital);
          }
          await Patient.collection.updateOne(
            { _id: user._id },
            { $unset: { hospital: "" } },
          );
        }

        if (
          hospitalId &&
          !user.hospitals.some(
            (h: any) => h.toString() === hospitalId.toString(),
          )
        ) {
          user.hospitals.push(hospitalId);
        }

        if (email && !user.email) {
          user.email = email.toLowerCase();
        }

        if (
          name &&
          (user.name === "Unknown Patient" ||
            user.name.toLowerCase().includes("unnamed") ||
            user.name.toLowerCase().includes("placeholder"))
        ) {
          user.name = name;
        }

        if (honorific && !user.honorific) {
          user.honorific = honorific;
        }
        if (gender && !user.gender) {
          user.gender = gender;
        }
        await user.save({ session });

        const creds = this.generateCredentials(
          name || user.name,
          mobile,
          dob || patientProfile?.dob,
        );
        generatedPassword = creds.password;
      }

      if (!patientProfile) {
        const mrn = await generateMrn(hospitalId, session);
        patientProfile = new PatientProfile({
          user: user._id,
          hospital: hospitalId,
          mrn,
          honorific: honorific || undefined,
          gender,
          dob: dob ? new Date(dob as string) : undefined,
          address: address ? address.trim() : "N/A",
          contactNumber: mobile,
          alternateNumber:
            typeof emergencyContact === "object" && emergencyContact?.mobile
              ? emergencyContact.mobile
              : typeof emergencyContact === "string"
                ? emergencyContact
                : "N/A",
          emergencyContactEmail,
          GuardianName: guardianName || "N/A",
          GuardianRelation: guardianRelation || "N/A",
          GuardianMobile: guardianMobile || "N/A",
          doctorReference: doctorReference || "N/A",
          height: finalVitals.height,
          weight: finalVitals.weight,
          bloodPressure: finalVitals.bloodPressure,
          temperature: finalVitals.temperature,
          pulse: finalVitals.pulse,
          spO2: finalVitals.spO2,
          glucose: finalVitals.glucose,
          maritalStatus,
          bloodGroup: bloodGroup || "N/A",
          conditions:
            conditions && typeof conditions !== "string"
              ? JSON.stringify(conditions)
              : conditions || medicalHistory || "None",
          medicalHistory:
            medicalHistory && typeof medicalHistory !== "string"
              ? JSON.stringify(medicalHistory)
              : medicalHistory || conditions || "None",
          allergies: allergiesString || "None",
          medications: medications || "None",
        });

        if (!dob && age) {
          const calculatedDob = new Date();
          calculatedDob.setFullYear(calculatedDob.getFullYear() - Number(age));
          patientProfile.dob = calculatedDob;
        }
        await patientProfile.save({ session });
      }

      let adDate = new Date();
      if (date) {
        const dateStr = String(date);
        const [y, m, d] = dateStr.split('-').map(Number);
        adDate = (y && m && d) ? new Date(y, m - 1, d) : new Date(dateStr);
        adDate.setHours(0, 0, 0, 0);
      }
      const finalTime =
        appointmentTime ||
        time ||
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });

      let finalPaymentAmount = paymentInput.amount || 0;
      let finalPaymentMethod = paymentInput.paymentMethod || "cash";
      let finalPaymentStatus = paymentInput.paymentStatus || "";

      if (visitTypeInput.toUpperCase() === "IPD") {
        const existingAdmission = await (
          IPDAdmission.findOne({
            patient: user._id,
            hospital: hospitalId,
            status: { $in: ["Active", "Discharge Initiated"] },
          }) as any
        )
          .unscoped()
          .sort({ createdAt: -1 });

        if (existingAdmission) {
          finalPaymentAmount = existingAdmission.amount || 0;
          finalPaymentMethod = existingAdmission.paymentMethod || "cash";
          finalPaymentStatus = existingAdmission.paymentStatus || "";
        }
      }

      let appointment: any = null as any;
      if (finalDoctorId) {
        const hospitalDoc = await Hospital.findById(hospitalId).session(session).select("name");
        const hospitalName = hospitalDoc?.name || "HOSPITAL";

        const appTypePrefix = visitTypeInput.toUpperCase() === "IPD" ? "IPD" :
          (visitTypeInput.toUpperCase() === "OPD" || visitTypeInput.toLowerCase() === "offline" ? "OPD" : "APT");
        const transactionId = await generateTransactionId(hospitalId as any, hospitalName, appTypePrefix as any, session);
        const generatedReceiptNumber = (finalPaymentStatus.toLowerCase() === "paid" || finalPaymentStatus.toLowerCase() === "completed") ? transactionId : undefined;

        appointment = new Appointment({
          appointmentId: transactionId,
          patient: user._id,
          doctor: finalDoctorId,
          hospital: hospitalId,
          createdBy: currentUser._id,
          department: department || "General",
          date: adDate,
          appointmentTime: finalTime,
          startTime: finalTime,
          endTime: finalTime,
          status:
            visitTypeInput.toUpperCase() === "IPD" ? "confirmed" : "Booked",
          type:
            visitTypeInput.toUpperCase() === "IPD"
              ? "IPD"
              : visitTypeInput.toLowerCase() === "online"
                ? "online"
                : "offline",
          visitType: visitTypeInput,
          urgency: "non-urgent",
          payment: {
            amount: finalPaymentAmount,
            paymentMethod: finalPaymentMethod,
            paymentStatus: finalPaymentStatus,
            receiptNumber: receiptNumber || generatedReceiptNumber,
          },
          amount: finalPaymentAmount,
          paymentStatus: finalPaymentStatus,
          symptoms: symptoms
            ? Array.isArray(symptoms)
              ? symptoms
              : [symptoms]
            : [],
          reason,
          mrn: patientProfile.mrn,
          vitals: finalVitals,
          patientDetails: {
            age: age || patientProfile.age,
            gender: gender || patientProfile.gender,
            duration: doctorProfile?.consultationDuration
              ? `${doctorProfile.consultationDuration} min`
              : "15 min",
          },
        });

        await appointment.save({ session });

        if (finalPaymentAmount > 0) {
          await Transaction.create(
            [
              {
                user: user._id,
                hospital: hospitalId,
                amount: finalPaymentAmount,
                type:
                  visitTypeInput.toUpperCase() === "IPD"
                    ? "ipd_advance"
                    : "appointment_booking",
                status: (finalPaymentStatus.toLowerCase() === "paid" || finalPaymentStatus.toLowerCase() === "completed") ? "completed" : "pending",
                referenceId: appointment._id,
                transactionId: appointment.appointmentId,
                receiptNumber: appointment.payment?.receiptNumber,
                date: new Date(),
                paymentMode: finalPaymentMethod.toLowerCase(),
                paymentDetails: {
                  cash:
                    finalPaymentMethod.toLowerCase() === "cash"
                      ? finalPaymentAmount
                      : 0,
                  upi:
                    finalPaymentMethod.toLowerCase() === "upi"
                      ? finalPaymentAmount
                      : 0,
                  card:
                    finalPaymentMethod.toLowerCase() === "card"
                      ? finalPaymentAmount
                      : 0,
                },
              },
            ],
            { session },
          );
        }
      }

      await session.commitTransaction();

      // ── TRIGGER NOTIFICATIONS FOR CONFIRMED/PAID APPOINTMENTS ───────────────
      if (appointment && (paymentStatus?.toLowerCase() === 'paid' || paymentStatus?.toLowerCase() === 'not_required' || !paymentStatus)) {
          try {
              const patientName = await resolvePatientIdentity(user._id, { ...user, patientDetails: appointment.patientDetails });
              const doctorName = doctorProfile?.user?.name || doctorProfile?.name || "Doctor";
              const appType = visitTypeInput?.toUpperCase() || "OPD";
              const dateStr = new Date(adDate).toDateString();
              
              const detailedMsg = `${appType} Appointment: Patient: ${patientName}, Doctor: ${doctorName}, Date: ${dateStr}, Time: ${finalTime}, Status: ${appointment.status}`;

              // 1. Notify Doctor
              if (doctorProfile?.user) {
                  await createNotification({ user: currentUser } as any, {
                      hospital: hospitalId,
                      recipient: doctorProfile.user._id || doctorProfile.user,
                      sender: currentUser._id,
                      type: "appointment_request",
                      message: detailedMsg,
                      relatedId: appointment._id as any,
                  });
              }

              // 2. Notify Staff (Helpdesk, Master Helpdesk, Admin)
              const staffToNotify = await (User.find({
                  $or: [
                      { hospital: hospitalId },
                      { role: { $in: ["masterhelpdesk", "super-admin"] } }
                  ],
                  role: { $in: ["helpdesk", "masterhelpdesk", "hospital-admin", "super-admin"] }
              }) as any).unscoped().select("_id role").lean();

              for (const staff of staffToNotify) {
                  // Avoid duplicate if doctor is also an admin
                  if (doctorProfile?.user && staff._id.toString() === (doctorProfile.user._id || doctorProfile.user).toString()) continue;
                  
                  await createNotification({ user: currentUser } as any, {
                      hospital: hospitalId,
                      recipient: staff._id,
                      sender: currentUser._id,
                      type: "appointment_request",
                      message: detailedMsg,
                      relatedId: appointment._id as any,
                  });
              }

              // 3. Real-time Sockets
              if (io) {
                  // Success feedback to patient room
                  io.to(`patient_${user._id}`).emit("appointment_confirmed", {
                      appointmentId: appointment._id,
                      message: "Your appointment has been successfully booked!",
                  });

                  // Alert Doctor
                  if (doctorProfile?.user) {
                      io.to(`doctor_${doctorProfile.user._id || doctorProfile.user}`).emit("notification:new", {
                          message: `New appointment from ${patientName}`,
                          type: "appointment",
                          id: appointment._id
                      });
                  }
                  
                  // Alert Staff rooms
                  staffToNotify.forEach(staff => {
                      io.to(`user_${staff._id}`).emit("notification:new", {
                          message: `New ${appType} booking for ${doctorName}`,
                          type: "appointment",
                          id: appointment._id
                      });
                  });
              }
          } catch (notifErr) {
              console.error("[MasterHelpdeskService] Notification error:", notifErr);
              // Don't fail the whole registration if notification fails
          }
      }

      return {
        message: finalDoctorId
          ? "Patient registered successfully with appointment"
          : "Patient registered successfully",
        patient: {
          id: user._id,
          _id: user._id,
          name: user.name,
          mrn: patientProfile.mrn,
          mobile: user.mobile,
          hospitals: user.hospitals || (user.hospital ? [user.hospital] : []),
        },
        visitId: appointment?._id || null,
        appointmentId: appointment?.appointmentId || null,
        credentials: {
          username: mobile,
          password: generatedPassword,
        },
      };
    } catch (error: any) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      session.endSession();
    }
  }

  async deleteAppointment(appointmentId: string, hospitalId: string) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Try deleting from offline Appointment model
      let deletedApp = await (Appointment.findOneAndDelete({
        _id: appointmentId,
        hospital: hospitalId,
      }) as any).unscoped().session(session);

      // 2. Fallback to MobileAppointment if not found
      if (!deletedApp) {
        deletedApp = await (MobileAppointment.findOneAndDelete({
          _id: appointmentId,
          hospital: hospitalId,
        }) as any).unscoped().session(session);
      }

      if (!deletedApp) {
        throw new ApiError(404, "Appointment not found or unauthorized");
      }

      // 3. Cascading delete related transactions
      await (Transaction.deleteMany({
        $or: [
          { referenceId: appointmentId },
          { transactionId: deletedApp.appointmentId }
        ],
        hospital: hospitalId,
      }) as any).unscoped().session(session);

      await session.commitTransaction();
      return { success: true, message: "Appointment and related transactions deleted" };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

export default new MasterHelpdeskService();
