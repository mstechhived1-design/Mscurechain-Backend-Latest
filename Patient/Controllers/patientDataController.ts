import { Request, Response } from "express";
import mongoose from "mongoose";
import Appointment from "../../Appointment/Models/Appointment.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import LabToken from "../../Lab/Models/LabToken.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import PatientProfile from "../Models/PatientProfile.js";
import DischargeRecord from "../../Discharge/Models/DischargeRecord.js";
import dischargeService from "../../services/discharge.service.js";
import PharmacyToken from "../../Pharmacy/Models/PharmacyToken.js";
import PharmacyOrder from "../../Pharmacy/Models/PharmacyOrder.js";
import MedicationRecord from "../../IPD/Models/MedicationRecord.js";
import { PatientRequest } from "../types/index.js";
import patientService from "../../services/patient.service.js";
import MobileAppointment from "../../Appointment/Models/MobileAppointment.js";
import User from "../../Auth/Models/User.js";
import { sanitizePatientName } from "../../utils/sanitizer.js";
import { Jimp } from "jimp";
import _jsQR from "jsqr";

const jsQR = (_jsQR as any).default || _jsQR;

/**
 * Helper to normalize pharmacy tokens/orders to prescription format
 */
const normalizePharma = (items: any[]) => {
  return items.map((item: any) => {
    const status = item.status?.toUpperCase() || "PRESCRIBED";
    const paymentStatus = item.paymentStatus?.toUpperCase() || "PENDING";
    const typeLabel = item.paymentStatus
      ? "Pharmacy Order"
      : "Pharmacy Request";
    const diagnosis =
      item.prescription?.diagnosis || item.diagnosis || typeLabel;

    return {
      _id: item._id,
      prescriptionDate: item.createdAt,
      diagnosis: diagnosis,
      displayType: typeLabel,
      medicines: (item.medicines || [])
        .map((med: any) => ({
          name: med.name,
          dosage: med.dosage || med.dose || "-",
          frequency: med.freq || med.frequency || "-",
          duration: med.duration || "-",
          instructions: `${med.quantity ? `Qty: ${med.quantity}` : ""}${med.dosage ? ` | ${med.dosage}` : ""}${med.status ? ` | Status: ${med.status.toUpperCase()}` : ""} | ${status}${item.paymentStatus ? ` [${paymentStatus}]` : ""}`,
        }))
        .filter((m: any) => m.name), // Ensure medicine names are present
      doctor: item.doctor,
      hospital: item.hospital,
      appointment: item.appointment,
      tokenNumber: item.tokenNumber,
      status: item.status,
      type: "pharma",
    };
  });
};

const normalizeMedRecords = (records: any[]) => {
  return records.map((reg) => ({
    _id: reg._id,
    prescriptionDate: reg.timestamp || reg.createdAt,
    diagnosis: `Inpatient Medication Administration`,
    displayType: "Hospital Administration",
    medicines: [
      {
        name: reg.drugName,
        dosage: reg.dose,
        frequency: reg.timeSlot,
        duration: "-",
        instructions: `Administered via ${reg.route} | Status: ${reg.status.toUpperCase()}`,
      },
    ],
    doctor: reg.administeredBy,
    hospital: reg.hospital,
    status: reg.status,
    type: "ipd-med",
  }));
};

/**
 * Get all appointments for the logged-in patient
 * Supports optional ?hospitalId= to filter by a specific hospital
 */
export const getPatientAppointments = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const { hospitalId } = req.query;
    const query: any = { patient: patientReq.user!._id };
    if (hospitalId) query.hospital = hospitalId;

    const appointments = await Appointment.find(query)
      .populate({
        path: "doctor",
        model: "DoctorProfile",
        select: "user specialties consultationFee department",
        populate: {
          path: "user",
          model: "User",
          select: "name email mobile",
        },
      })
      .populate("hospital", "name address logo phone city")
      .populate(
        "prescription",
        "diagnosis medicines prescriptionDate followUpDate",
      )
      .populate("labToken", "tokenNumber status tests priority")
      .sort({ date: -1, createdAt: -1 })
      .limit(50);

    // Fetch Mobile Appointments - MobileAppointment HAS the tenant plugin, so we MUST use .unscoped()
    // because a patient's appointments might be across different hospital tenants.
    const profiles = await (PatientProfile.find({ user: patientReq.user!._id }) as any).unscoped().select("_id").lean();
    const profileIds = profiles.map(p => p._id);
    
    console.log(`[getPatientAppointments] Fetching for User: ${patientReq.user!._id}, Profiles: ${profileIds}`);

    const mobileAppointments = await (MobileAppointment.find({ 
      patient: { $in: profileIds },
      ...(hospitalId ? { hospital: hospitalId } : {}) 
    }) as any)
      .unscoped() // CRITICAL: Allow seeing appointments across all tenants
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
      .populate("hospital", "name address logo phone city")
      .sort({ date: -1, startTime: -1 })
      .limit(50)
      .lean();

    console.log(`[getPatientAppointments] Found ${appointments.length} legacy and ${mobileAppointments.length} mobile appointments`);

    const merged = [...appointments, ...mobileAppointments].sort(
      (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    res.json({
      success: true,
      count: merged.length,
      data: merged,
    });
  } catch (err) {
    console.error("Error fetching patient appointments:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching appointments",
    });
  }
};

/**
 * Get all prescriptions for the logged-in patient
 */
export const getPatientPrescriptions = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const userId = patientReq.user!._id;
    const [prescriptions, pharmacyTokens, pharmacyOrders] = await Promise.all([
      Prescription.find({ patient: userId })
        .populate({
          path: "doctor",
          model: "DoctorProfile",
          select: "user specialties department",
          populate: {
            path: "user",
            model: "User",
            select: "name email mobile",
          },
        })
        .populate("hospital", "name address logo phone city")
        .populate("appointment", "date appointmentTime status type")
        .sort({ prescriptionDate: -1, createdAt: -1 })
        .limit(50)
        .lean(),
      PharmacyToken.find({ patient: userId })
        .populate({
          path: "doctor",
          model: "DoctorProfile",
          select: "user specialties",
          populate: {
            path: "user",
            model: "User",
            select: "name email mobile",
          },
        })
        .populate("hospital", "name address logo city")
        .populate("appointment", "date appointmentTime")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      PharmacyOrder.find({ patient: userId })
        .populate({
          path: "doctor",
          model: "DoctorProfile",
          select: "user specialties",
          populate: {
            path: "user",
            model: "User",
            select: "name email mobile",
          },
        })
        .populate("hospital", "name address logo city")
        .populate("prescription", "diagnosis")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    const medicationRecords = await MedicationRecord.find({ patient: userId })
      .populate({
        path: "administeredBy",
        select: "name mobile",
      })
      .populate("hospital", "name")
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    // De-duplicate: If a token has a corresponding order, prefer the order
    const orderTokenNumbers = new Set(
      pharmacyOrders.map((o) => o.tokenNumber).filter(Boolean),
    );
    const uniqueTokens = pharmacyTokens.filter(
      (t) => !orderTokenNumbers.has(t.tokenNumber),
    );

    const normalizedTokens = normalizePharma(uniqueTokens);
    const normalizedOrders = normalizePharma(pharmacyOrders);
    const normalizedMedRecs = normalizeMedRecords(medicationRecords || []);

    const merged = [
      ...prescriptions,
      ...normalizedTokens,
      ...normalizedOrders,
      ...normalizedMedRecs,
    ]
      .sort(
        (a: any, b: any) =>
          new Date(b.prescriptionDate || b.createdAt).getTime() -
          new Date(a.prescriptionDate || a.createdAt).getTime(),
      )
      .slice(0, 50);

    res.json({
      success: true,
      count: merged.length,
      data: merged,
    });
  } catch (err) {
    console.error("Error fetching patient prescriptions:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching prescriptions",
    });
  }
};

/**
 * Get all lab records for the logged-in patient.
 * Returns LabOrders (with entered results, units, subTests) for completed tests,
 * and LabTokens (pending/ordered but not yet processed) for visibility.
 */
export const getPatientLabRecords = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const userId = patientReq.user!._id;

    // 1. Fetch LabOrders (actual results entered by lab staff)
    //    Populate tests.test to resolve the LabTest name, category and price
    const labOrders = await LabOrder.find({ patient: userId })
      .populate({
        path: "doctor",
        model: "User",
        select: "name email mobile",
      })
      .populate("hospital", "name address logo phone city")
      .populate("tests.test", "testName name price category")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // 2. Fetch LabTokens (doctor-ordered, may not have a LabOrder yet)
    const labTokens = await LabToken.find({ patient: userId })
      .populate({
        path: "doctor",
        model: "DoctorProfile",
        select: "user specialties department",
        populate: {
          path: "user",
          model: "User",
          select: "name email mobile",
        },
      })
      .populate("hospital", "name address logo phone city")
      .populate("appointment", "date appointmentTime status")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // 3. Find LabTokens that DO NOT have a corresponding LabOrder (still pending)
    const orderedTokenNumbers = new Set(
      labOrders.map((o: any) => o.tokenNumber).filter(Boolean),
    );
    const pendingTokens = labTokens.filter(
      (t: any) => !orderedTokenNumbers.has(t.tokenNumber),
    );

    // 4. Resolve doctor names for LabOrders where populate returned null
    //    (LabOrder.doctor sometimes stores a DoctorProfile _id instead of a User _id)
    const unpopulatedDoctorIds = labOrders
      .filter((o: any) => !o.doctor?.name)
      .map((o: any) => o.doctor?._id || o.doctor)
      .filter((id: any) => id);

    const doctorNameMap = new Map<string, string>();
    if (unpopulatedDoctorIds.length > 0) {
      // Try as DoctorProfile IDs first
      const drProfiles = (await mongoose
        .model("DoctorProfile")
        .find({ _id: { $in: unpopulatedDoctorIds } })
        .populate("user", "name")
        .lean()) as any[];
      drProfiles.forEach((p: any) => {
        if (p.user?.name) doctorNameMap.set(p._id.toString(), p.user.name);
      });
      // Fallback: try as User IDs
      const drUsers = (await mongoose
        .model("User")
        .find({ _id: { $in: unpopulatedDoctorIds } })
        .select("name")
        .lean()) as any[];
      drUsers.forEach((u: any) => {
        if (!doctorNameMap.has(u._id.toString())) {
          doctorNameMap.set(u._id.toString(), u.name);
        }
      });
    }

    // 5. Normalize LabOrders — full result details, resolved names
    const normalizedOrders = labOrders.map((order: any) => {
      const rawDoctorId =
        order.doctor?._id?.toString() || order.doctor?.toString();
      const doctorName =
        order.doctor?.name || doctorNameMap.get(rawDoctorId) || null;

      return {
        _id: order._id,
        source: "lab-order",
        tokenNumber: order.tokenNumber,
        status: order.status,
        doctorNotified: order.doctorNotified,
        doctor: doctorName ? { name: doctorName } : null,
        hospital: order.hospital,
        paymentStatus: order.paymentStatus,
        sampleCollectedAt: order.sampleCollectedAt,
        resultsEnteredAt: order.resultsEnteredAt,
        completedAt: order.completedAt,
        createdAt: order.createdAt,
        tests: (order.tests || []).map((t: any) => {
          const tName =
            t.test?.testName || t.test?.name || t.testName || "Unknown Test";
          return {
            name: tName,
            testName: tName,
            testId: t.test?._id || t.test,
            category: t.test?.category,
            price: t.test?.price,
            status: t.status,
            result: t.result,
            remarks: t.remarks,
            isAbnormal: t.isAbnormal,
            subTests: (t.subTests || []).map((s: any) => ({
              name: s.name,
              result: s.result,
              unit: s.unit,
              range: s.range,
            })),
          };
        }),
      };
    });

    // 5. Normalize pending LabTokens (no results yet)
    const normalizedPending = pendingTokens.map((token: any) => ({
      _id: token._id,
      source: "lab-token",
      tokenNumber: token.tokenNumber,
      status: token.status || "prescribed",
      doctorNotified: false,
      doctor: token.doctor,
      hospital: token.hospital,
      appointment: token.appointment,
      priority: token.priority,
      notes: token.notes,
      createdAt: token.createdAt,
      tests: (token.tests || []).map((t: any) => {
        const tName = t.name || t.testName || "Unknown Test";
        return {
          name: tName,
          testName: tName,
          category: t.category,
          price: t.price,
          instructions: t.instructions,
          status: "pending",
          result: null,
          subTests: [],
        };
      }),
    }));

    // 6. Merge: completed orders first, then pending tokens
    const merged = [...normalizedOrders, ...normalizedPending]
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 50);

    res.json({
      success: true,
      count: merged.length,
      data: merged,
    });
  } catch (err) {
    console.error("Error fetching patient lab records:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching lab records",
    });
  }
};

/**
 * Get appointments booked by helpdesk for the patient
 */
export const getPatientHelpdeskPrescriptions = async (
  req: Request,
  res: Response,
) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const helpdeskAppointments = await Appointment.find({
      patient: patientReq.user!._id,
      createdBy: { $exists: true, $ne: null },
    })
      .populate({
        path: "doctor",
        model: "DoctorProfile",
        populate: {
          path: "user",
          model: "User",
          select: "name email mobile",
        },
      })
      .populate("hospital")
      .populate("createdBy")
      .populate("prescription")
      .populate("labToken")
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      count: helpdeskAppointments.length,
      data: helpdeskAppointments,
    });
  } catch (err) {
    console.error("Error fetching helpdesk appointments:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching helpdesk appointments",
    });
  }
};

/**
 * Get all hospitals where the patient is registered or has visited.
 * Sources:
 *  - PatientProfile.hospital  (where they were first registered)
 *  - Appointment.hospital     (every hospital they've had an appointment at)
 * Only hospitals linked to THIS patient appear — all others in the DB are excluded.
 */
export const getPatientHospitals = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const userId = new mongoose.Types.ObjectId(patientReq.user!._id);

    // 1. Get registration hospitals from all PatientProfiles
    const profiles = await PatientProfile.find({ user: userId })
      .select("hospital")
      .lean();

    // 2. Get distinct hospital IDs from all appointments for this patient
    const appointmentHospitalIds: mongoose.Types.ObjectId[] =
      await Appointment.distinct("hospital", {
        patient: userId,
        hospital: { $exists: true, $ne: null },
      });

    // 3. Union both sources — deduplicate by string ID
    const hospitalIdSet = new Set<string>();
    profiles.forEach((p) => {
      if (p.hospital) hospitalIdSet.add(p.hospital.toString());
    });
    for (const id of appointmentHospitalIds) {
      if (id) hospitalIdSet.add(id.toString());
    }

    if (hospitalIdSet.size === 0) {
      // For global patients with no registrations, return all hospitals
      const allHospitals = await mongoose.model("Hospital")
        .find({})
        .select("name address city phone logo location")
        .limit(20)
        .lean();
      
      return res.json({ 
        success: true, 
        count: allHospitals.length, 
        data: allHospitals.map(h => ({ ...h, isRegistered: false })) 
      });
    }

    const hospitalObjectIds = [...hospitalIdSet].map(
      (id) => new mongoose.Types.ObjectId(id),
    );

    // 4. Fetch hospital details — only for THIS patient's hospitals
    const hospitals = (await mongoose
      .model("Hospital")
      .find({ _id: { $in: hospitalObjectIds } })
      .select("name address city phone logo location")
      .lean()) as any[];

    // 5. Enrich with visit counts from Appointment aggregate
    const visitAgg = await Appointment.aggregate([
      { $match: { patient: userId, hospital: { $in: hospitalObjectIds } } },
      {
        $group: {
          _id: "$hospital",
          visitCount: { $sum: 1 },
          lastVisit: { $max: "$date" },
        },
      },
    ]);
    const visitMap = new Map<
      string,
      { visitCount: number; lastVisit: Date | null }
    >();
    for (const v of visitAgg) {
      visitMap.set(v._id.toString(), {
        visitCount: v.visitCount,
        lastVisit: v.lastVisit,
      });
    }

    // 6. Shape the final response with name + address for UI display
    const data = hospitals
      .map((h: any) => {
        const stats = visitMap.get(h._id.toString());
        return {
          _id: h._id,
          name: h.name,
          address: h.address || "",
          city: h.city || "",
          phone: h.phone || "",
          logo: h.logo || "",
          location: h.location,
          visitCount: stats?.visitCount ?? 0,
          lastVisit: stats?.lastVisit ?? null,
          isRegistered: profiles.some(
            (p) => p.hospital?.toString() === h._id.toString(),
          ),
        };
      })
      .sort((a: any, b: any) => {
        // Primary registered hospital first, then by most recent visit
        if (a.isRegistered && !b.isRegistered) return -1;
        if (!a.isRegistered && b.isRegistered) return 1;
        return (
          new Date(b.lastVisit || 0).getTime() -
          new Date(a.lastVisit || 0).getTime()
        );
      });

    res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error("Error fetching patient hospitals:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching visited hospitals",
    });
  }
};

/**
 * Get comprehensive patient dashboard data
 * Supports optional ?hospitalId= to scope all data to a specific hospital
 */
export const getPatientDashboardData = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const userId = new mongoose.Types.ObjectId(patientReq.user!._id);
    const { hospitalId } = req.query;
    console.log(
      `[Dashboard] Fetching data for patient user ID: ${userId}, hospitalId filter: ${hospitalId || "none"}`,
    );

    // Build hospital filter — applied to all queries when provided
    const hospitalFilter: any = hospitalId
      ? { hospital: new mongoose.Types.ObjectId(hospitalId as string) }
      : {};

    const [
      appointments,
      prescriptions,
      pharmacyTokens,
      pharmacyOrders,
      labRecords,
      medicationRecords,
      helpdeskItems,
      dischargeRecords,
      profile,
      currentUser,
      mobileAppointments,
      labOrders,
    ] = await Promise.all([
      // Recent appointments — filtered by hospital if provided
      Appointment.find({ patient: userId, ...hospitalFilter })
        .populate({
          path: "doctor",
          model: "DoctorProfile",
          populate: {
            path: "user",
            model: "User",
            select: "name email mobile role",
          },
        })
        .populate("hospital", "name address logo")
        .populate("prescription", "diagnosis prescriptionDate")
        .populate("labToken", "status tokenNumber")
        .sort({ date: -1, createdAt: -1 })
        .limit(20)
        .lean(),

      // Recent prescriptions (OPD) — filtered by hospital if provided
      Prescription.find({ patient: userId, ...hospitalFilter })
        .populate({
          path: "doctor",
          model: "DoctorProfile",
          populate: {
            path: "user",
            model: "User",
            select: "name email mobile role",
          },
        })
        .populate("hospital", "name address logo")
        .sort({ prescriptionDate: -1 })
        .limit(20)
        .lean(),

      // Pharmacy tokens — filtered by hospital if provided
      PharmacyToken.find({ patient: userId, ...hospitalFilter })
        .populate({
          path: "doctor",
          model: "DoctorProfile",
          populate: {
            path: "user",
            model: "User",
            select: "name email mobile role",
          },
        })
        .populate("hospital", "name address")
        .populate("appointment", "date appointmentTime")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),

      // Pharmacy orders — filtered by hospital if provided
      PharmacyOrder.find({ patient: userId, ...hospitalFilter })
        .populate({
          path: "doctor",
          model: "DoctorProfile",
          populate: {
            path: "user",
            model: "User",
            select: "name email mobile role",
          },
        })
        .populate("hospital", "name address")
        .populate("prescription", "diagnosis")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      // Recent lab records (requests) — filtered by hospital if provided
      LabToken.find({ patient: userId, ...hospitalFilter })
        .populate({
          path: "doctor",
          model: "DoctorProfile",
          populate: {
            path: "user",
            model: "User",
            select: "name email mobile role",
          },
        })
        .populate("hospital", "name address")
        .populate("appointment", "date")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),

      // Inpatient medication administrations — filtered by hospital if provided
      MedicationRecord.find({ patient: userId, ...hospitalFilter })
        .populate({
          path: "administeredBy",
          select: "name mobile",
        })
        .populate("hospital", "name")
        .sort({ timestamp: -1 })
        .limit(50)
        .lean(),

      // Appointments booked by helpdesk — filtered by hospital if provided
      Appointment.find({
        patient: userId,
        createdBy: { $exists: true, $ne: null },
        ...hospitalFilter,
      })
        .populate({
          path: "doctor",
          model: "DoctorProfile",
          populate: {
            path: "user",
            model: "User",
            select: "name email mobile role",
          },
        })
        .populate("hospital", "name")
        .populate("createdBy", "name")
        .populate("prescription", "diagnosis")
        .populate("labToken", "tokenNumber")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      (async () => {
        const profiles = await (PatientProfile.find({ user: userId }) as any).unscoped().select("mrn").lean();
        const userMobile = patientReq.user?.mobile;

        const mrns = profiles.map((p: any) => p.mrn).filter(Boolean);
        if (mrns.length === 0 && !userMobile) return [];

        const query: any = { status: "completed" };
        if (hospitalId) query.hospital = hospitalId;

        if (mrns.length > 0 && userMobile) {
          query.$or = [{ mrn: { $in: mrns } }, { phone: userMobile }];
        } else if (mrns.length > 0) {
          query.mrn = { $in: mrns };
        } else {
          query.phone = userMobile;
        }

        return DischargeRecord.find(query)
          .select("documentId patientName diagnosis dischargeDate followUpDate hospitalName specialistType consultants")
          .sort({ dischargeDate: -1 })
          .limit(10)
          .lean();
      })(),

      (PatientProfile.find({ user: userId }) as any).unscoped()
        .populate({ path: "user", select: "name email mobile role avatar age gender height weight bloodGroup address allergies conditions emergencyContactName emergencyContactPhone emergencyContactRelation" })
        .populate("hospital", "name address logo")
        .lean(),
      User.findById(userId).select("name email mobile role avatar age gender height weight bloodGroup address allergies conditions emergencyContactName emergencyContactPhone emergencyContactRelation").lean(),
      (async () => {
        const profiles = await (PatientProfile.find({ user: userId }) as any).unscoped().select("_id").lean();
        const profileIds = (profiles || []).map(p => p._id);
        return (MobileAppointment.find({ patient: { $in: profileIds }, ...hospitalFilter }) as any)
          .populate({
            path: "doctor",
            model: "DoctorProfile",
            populate: {
              path: "user",
              model: "User",
              select: "name email mobile role",
            },
          })
          .populate("hospital", "name address logo")
          .sort({ date: -1, startTime: -1 })
          .limit(10)
          .lean();
      })(),
      LabOrder.find({ patient: userId, ...hospitalFilter })
        .populate({
          path: "doctor",
          model: "User",
          select: "name email mobile",
        })
        .populate("hospital", "name address logo")
        .populate("tests.test", "testName name price category")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    const normalizedMedRecs = normalizeMedRecords(medicationRecords || []);
    
    const allPrescriptions = [...prescriptions, ...normalizedMedRecs]
      .sort((a: any, b: any) => {
        const dateB = new Date(b.prescriptionDate || b.createdAt || 0).getTime();
        const dateA = new Date(a.prescriptionDate || a.createdAt || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, 50);

    // Select the "active" profile based on hospitalId filter
    let activeProfile: any = profile.length > 0 ? profile[0] : null;
    if (hospitalId && profile.length > 0) {
      const matched = profile.find(
        (p: any) =>
          p.hospital?._id?.toString() === hospitalId.toString() ||
          p.hospital?.toString() === hospitalId.toString(),
      );
      if (matched) activeProfile = matched;
    }

    // Fallback: If no profile exists (e.g., global mobile registration),
    // create a virtual profile shell so the frontend has user data.
    if (!activeProfile && currentUser) {
      activeProfile = {
        user: currentUser,
        mrn: "N/A",
        hospital: null,
      };
    }

    const user = activeProfile ? activeProfile.user : currentUser;

    // --- Lab Records Normalization (Deduplication + Doctor Name Resolution) ---
    // 1. Identify tokens that already have an order
    const orderedTokenNumbers = new Set(
      labOrders.map((o: any) => o.tokenNumber).filter(Boolean),
    );
    const uniqueTokens = (labRecords || []).filter(
      (t: any) => !orderedTokenNumbers.has(t.tokenNumber),
    );

    // 2. Resolve doctor names for LabOrders (catch cases where ID doesn't match User ref)
    // We fetch LabOrders again without population just for the IDs, or trust that lean() might keep them if populate fails
    // Actually, a better way is to iterate and find any null/missing names
    const doctorNameMap = new Map<string, string>();
    const ordersWithMissingDoctor = labOrders.filter(
      (o: any) => !o.doctor?.name,
    );

    // To get the IDs that failed to populate, we might need the original documents
    // But let's try to find if o.doctor itself is the ID string/ObjectId
    const missingIds = ordersWithMissingDoctor
      .map((o: any) => o.doctor?._id || o.doctor)
      .filter(
        (id: any) => id && mongoose.Types.ObjectId.isValid(id.toString()),
      );

    if (missingIds.length > 0) {
      const [drProfiles, drUsers] = await Promise.all([
        mongoose
          .model("DoctorProfile")
          .find({ _id: { $in: missingIds } })
          .populate("user", "name")
          .lean(),
        mongoose
          .model("User")
          .find({ _id: { $in: missingIds } })
          .select("name")
          .lean(),
      ]);

      (drProfiles as any[]).forEach((p) => {
        if (p.user?.name) doctorNameMap.set(p._id.toString(), p.user.name);
      });
      (drUsers as any[]).forEach((u) => {
        doctorNameMap.set(u._id.toString(), u.name);
      });
    }

    // 3. Normalize LabOrders (Results)
    const normalizedOrders = labOrders.map((order: any) => {
      const rawDoctorId =
        order.doctor?._id?.toString() || order.doctor?.toString();
      const doctorName =
        order.doctor?.name || doctorNameMap.get(rawDoctorId) || "Hospital Lab";

      return {
        _id: order._id,
        source: "lab-order",
        tokenNumber: order.tokenNumber,
        status: order.status,
        doctor: { name: doctorName },
        hospital: order.hospital,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
        resultsEnteredAt: order.resultsEnteredAt,
        completedAt: order.completedAt,
        tests: (order.tests || []).map((t: any) => {
          const tName =
            t.test?.testName || t.test?.name || t.testName || "Unknown";
          return {
            name: tName,
            testName: tName, // for compatibility
            status: t.status,
            result: t.result,
            remarks: t.remarks,
            isAbnormal: t.isAbnormal,
            subTests: (t.subTests || []).map((st: any) => ({
              name: st.name,
              result: st.result,
              unit: st.unit,
              range: st.range,
            })),
          };
        }),
      };
    });

    // 4. Normalize unique LabTokens (Requests)
    const normalizedTokens = uniqueTokens.map((token: any) => ({
      _id: token._id,
      source: "lab-token",
      tokenNumber: token.tokenNumber,
      status: token.status || "prescribed",
      doctor: token.doctor,
      hospital: token.hospital,
      createdAt: token.createdAt,
      tests: (token.tests || []).map((t: any) => {
        const tName = t.name || t.testName || "Unknown";
        return {
          name: tName,
          testName: tName,
          category: t.category,
          status: "pending",
        };
      }),
    }));

    const mergedLabRecords = [...normalizedOrders, ...normalizedTokens].sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const finalApts = [...appointments, ...mobileAppointments].sort((a: any, b: any) => 
      new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    );

    res.json({
      success: true,
      data: {
        user: {
          ...((currentUser as any) || user),
          name: sanitizePatientName(((currentUser as any) || user).name),
        },
        profile: activeProfile,
        appointments: {
          count: finalApts.length,
          data: finalApts,
        },
        prescriptions: {
          count: allPrescriptions.length,
          data: allPrescriptions,
        },
        labRecords: {
          count: mergedLabRecords.length,
          data: mergedLabRecords,
        },
        dischargeRecords: {
          count: dischargeRecords.length,
          data: dischargeRecords,
        },
        helpdeskPrescriptions: {
          count: helpdeskItems.length,
          data: helpdeskItems,
        },
      },
    });
  } catch (err) {
    console.error("Error fetching patient dashboard data:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching dashboard data",
    });
  }
};

/**
 * Scan QR code from an uploaded image (Server-side)
 */
export const scanQRCode = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No image uploaded" });
    }

    const image = await Jimp.read(req.file.buffer);
    const { data, width, height } = image.bitmap;
    
    // jsQR expects a Uint8ClampedArray
    const code = jsQR(new Uint8ClampedArray(data), width, height);

    if (code) {
      console.log(`[QR Scan] Decoded: ${code.data}`);
      return res.json({ success: true, data: code.data });
    } else {
      return res.status(404).json({ success: false, message: "No QR code found in image" });
    }
  } catch (error) {
    console.error("QR Scan Error:", error);
    res.status(500).json({ success: false, message: "Error processing image" });
  }
};
