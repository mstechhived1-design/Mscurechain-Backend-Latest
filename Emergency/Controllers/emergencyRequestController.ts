import { Request, Response } from "express";
import { validationResult } from "express-validator";
import mongoose from "mongoose";
import EmergencyRequest from "../Models/EmergencyRequest.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import AmbulancePersonnel from "../Models/AmbulancePersonnel.js";
import { EmergencyAuthRequest } from "../types/index.js";
import { AuthRequest } from "../../Auth/types/index.js";
import emergencyService from "../../services/emergency.service.js";
import HelpDesk from "../../Helpdesk/Models/HelpDesk.js";
import User from "../../Auth/Models/User.js";
import { createNotification } from "../../Notification/Controllers/notificationController.js";

// Helper to notify all helpdesk users of target hospitals
const notifyHelpdesks = async (hospitals: any[], emergencyRequest: any, sender: any, senderModel: "User" | "Patient") => {
  try {
    for (const hospitalId of hospitals) {
      // Find all helpdesk users for this hospital
      const helpdeskUsers = await (User.find({
        hospital: hospitalId,
        role: "helpdesk",
        status: "active"
      }) as any).unscoped();

      const message = `NEW EMERGENCY SIGNAL: ${emergencyRequest.patientName} (${emergencyRequest.emergencyType}) | SEVERITY: ${emergencyRequest.severity.toUpperCase()}`;

      for (const helpdeskUser of helpdeskUsers) {
        await createNotification(null, {
          hospital: hospitalId,
          recipient: helpdeskUser._id,
          recipientModel: "User",
          sender: sender,
          senderModel: senderModel,
          type: "emergency_request",
          message: message,
          relatedId: emergencyRequest._id
        });
      }
    }
  } catch (err) {
    console.error("Error in notifyHelpdesks:", err);
  }
};

// Helper to instantly update the creator (Patient or Ambulance)
const emitEmergencyUpdateToCreator = (req: any, emergencyRequest: any) => {
  const io = req.io;
  if (!io) return;

  // Broadcast to Ambulance Personnel
  if (emergencyRequest.ambulancePersonnel) {
    io.to(`user_${emergencyRequest.ambulancePersonnel.toString()}`).emit('emergency:update', emergencyRequest);
  }

  // Broadcast to Patient
  if (emergencyRequest.patient) {
    io.to(`user_${emergencyRequest.patient.toString()}`).emit('emergency:update', emergencyRequest);
    io.to(`patient_${emergencyRequest.patient.toString()}`).emit('emergency:update', emergencyRequest);
  }
};

// Create emergency request (Ambulance Personnel)
export const createEmergencyRequest = async (
  req: EmergencyAuthRequest,
  res: Response,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  try {
    const {
      patientName,
      patientAge,
      patientGender,
      patientMobile,
      emergencyType,
      description,
      severity,
      vitals,
      currentLocation,
      eta,
      targetHospitals, // array of hospital IDs, if empty send to all
    } = req.body;

    if (!req.ambulancePersonnel) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Get hospitals to send request to
    let hospitals;
    if (targetHospitals && targetHospitals.length > 0) {
      hospitals = await Hospital.find({ _id: { $in: targetHospitals } });
    } else {
      // Send to all non-suspended hospitals (includes 'pending' — default status on creation)
      hospitals = await (Hospital.find({ status: { $ne: "suspended" } }) as any);
    }

    if (hospitals.length === 0) {
      return res.status(404).json({
        message: "No hospitals available to receive request",
      });
    }

    // Create request
    const requestedHospitals = hospitals.map((hospital) => ({
      hospital: hospital._id,
      status: "pending" as const,
    }));

    const emergencyRequest = new EmergencyRequest({
      ambulancePersonnel: req.ambulancePersonnel._id,
      patientName,
      patientAge,
      patientGender,
      patientMobile,
      emergencyType,
      description,
      severity,
      vitals,
      currentLocation,
      eta,
      requestedHospitals,
      status: "pending",
    });

    await emergencyRequest.save();

    // Populate for response
    await emergencyRequest.populate(
      "requestedHospitals.hospital",
      "name address",
    );
    // Manually populate ambulancePersonnel using unscoped() to bypass tenantPlugin
    const populatedPersonnel = await (
      AmbulancePersonnel.findById(emergencyRequest.ambulancePersonnel).select(
        "name employeeId vehicleNumber",
      ) as any
    ).unscoped();
    if (populatedPersonnel) {
      (emergencyRequest as any).ambulancePersonnel = populatedPersonnel;
    }

    // 🔥 NOTIFY HELPDESK USERS
    await notifyHelpdesks(hospitals.map(h => h._id), emergencyRequest, req.ambulancePersonnel._id, "User");

    res.status(201).json({
      message: "Emergency request sent successfully",
      request: emergencyRequest,
    });
  } catch (err) {
    console.error("Create emergency request error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Create emergency request (Patient)
export const createPatientEmergencyRequest = async (
  req: AuthRequest,
  res: Response,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  try {
    const {
      emergencyType,
      description,
      severity,
      vitals,
      currentLocation,
      hospitalId, // Mandatory for patient request (Backward compatibility)
      hospitalIds, // Optional array of hospital IDs
    } = req.body;

    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Determine target hospitals
    const targetIds = Array.isArray(hospitalIds)
      ? hospitalIds
      : hospitalId
        ? [hospitalId]
        : [];

    if (targetIds.length === 0) {
      return res
        .status(400)
        .json({ message: "At least one target hospital ID is required" });
    }

    // Get target hospitals
    const hospitals = await Hospital.find({ _id: { $in: targetIds } });
    if (hospitals.length === 0) {
      return res.status(404).json({ message: "No valid hospitals found" });
    }

    // Create request
    const requestedHospitals = hospitals.map((h) => ({
      hospital: h._id,
      status: "pending" as const,
    }));

    // Get patient details from req.user
    const patientName = req.user.name || "Unknown Patient";
    const patientAge = (req.user as any).age || 0;
    // Normalize gender to lowercase to match EmergencyRequest schema enum
    const rawGender = (req.user as any).gender || "other";
    const patientGender =
      rawGender.toLowerCase() === "male" || rawGender.toLowerCase() === "female"
        ? (rawGender.toLowerCase() as "male" | "female")
        : "other";
    const patientMobile = req.user.mobile;

    const emergencyRequest = new EmergencyRequest({
      patient: req.user._id,
      patientName,
      patientAge,
      patientGender,
      patientMobile,
      emergencyType,
      description,
      severity,
      vitals,
      currentLocation,
      requestedHospitals,
      status: "pending",
    });

    await emergencyRequest.save();

    // Populate for response
    await emergencyRequest.populate(
      "requestedHospitals.hospital",
      "name address",
    );

    // 🔥 NOTIFY HELPDESK USERS
    await notifyHelpdesks(hospitals.map(h => h._id), emergencyRequest, req.user._id, req.user.role === "patient" ? "Patient" : "User");

    res.status(201).json({
      message:
        hospitals.length > 1
          ? `Emergency request broadcasted to ${hospitals.length} hospital helpdesks`
          : "Emergency request sent to hospital helpdesk",
      request: emergencyRequest,
    });
  } catch (err) {
    console.error("Create patient emergency request error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all emergency requests for ambulance personnel
export const getMyEmergencyRequests = async (
  req: EmergencyAuthRequest,
  res: Response,
) => {
  try {
    if (!req.ambulancePersonnel) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const requests = await EmergencyRequest.find({
      ambulancePersonnel: req.ambulancePersonnel._id,
    })
      .populate("requestedHospitals.hospital", "name address phone")
      .populate("acceptedByHospital", "name address")
      .sort({ createdAt: -1 })
      .lean();

    // 🚀 BULK HYDRATION: Fetch helpdesk details for all accepted requests once
    const helpdeskIds = requests
      .map(r => r.acceptedByHelpdesk)
      .filter(Boolean);

    if (helpdeskIds.length > 0) {
      const helpdeskResults = await (HelpDesk.find({
        _id: { $in: helpdeskIds }
      }).select("name mobile") as any).unscoped();

      const helpdeskMap = new Map();
      helpdeskResults.forEach((h: any) => helpdeskMap.set(h._id.toString(), h));

      requests.forEach((r: any) => {
        if (r.acceptedByHelpdesk) {
          const h = helpdeskMap.get(r.acceptedByHelpdesk.toString());
          if (h) r.acceptedByHelpdesk = h;
        }
      });
    }

    res.json({ requests });
  } catch (err) {
    console.error("Get my emergency requests error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all emergency requests for the current patient
export const getPatientEmergencyRequests = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const requests = await EmergencyRequest.find({
      patient: req.user._id,
    })
      .populate("requestedHospitals.hospital", "name address phone")
      .populate("acceptedByHospital", "name address")
      .sort({ createdAt: -1 });

    res.json({ requests });
  } catch (err) {
    console.error("Get patient emergency requests error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get a single emergency request by ID (Auth check for patient or personnel)
export const getEmergencyRequestById = async (
  req: AuthRequest | EmergencyAuthRequest,
  res: Response,
) => {
  try {
    const { requestId } = req.params;
    const emergencyRequest = await EmergencyRequest.findById(requestId)
      .populate("requestedHospitals.hospital", "name address phone")
      .populate("acceptedByHospital", "name address phone");

    if (!emergencyRequest) {
      return res.status(404).json({ message: "Emergency request not found" });
    }

    // Security check: must be the patient, the creating personnel, or a requested hospital
    const isPatient =
      emergencyRequest.patient &&
      (req as any).user?._id?.toString() ===
      emergencyRequest.patient.toString();
    const isPersonnel =
      emergencyRequest.ambulancePersonnel &&
      (req as any).ambulancePersonnel?._id?.toString() ===
      emergencyRequest.ambulancePersonnel.toString();

    // Check if user is helpdesk at one of the requested hospitals
    let isRequestedHospital = false;
    if ((req as any).user?.role === "helpdesk") {
      const hospitalId = (req as any).user.hospital;
      isRequestedHospital = emergencyRequest.requestedHospitals.some(
        (rh) => rh.hospital._id.toString() === hospitalId?.toString(),
      );
    }

    if (!isPatient && !isPersonnel && !isRequestedHospital) {
      return res.status(403).json({ message: "Forbidden" });
    }

    res.json({ request: emergencyRequest });
  } catch (err) {
    console.error("Get emergency request by ID error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get emergency requests for helpdesk (at their hospital)
export const getHospitalEmergencyRequests = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    if (!req.user || req.user.role !== "helpdesk") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const hospitalIdRaw = (req.user as any).hospital;
    if (!hospitalIdRaw) {
      return res
        .status(400)
        .json({ message: "Hospital not found on user profile" });
    }

    const hospitalId = new mongoose.Types.ObjectId(hospitalIdRaw.toString());
    console.log(`[Emergency] Fetching requests for hospital: ${hospitalId}`);

    const requests = await EmergencyRequest.find({
      "requestedHospitals.hospital": hospitalId,
    })
      .populate({
        path: "ambulancePersonnel",
        select: "name employeeId vehicleNumber mobile",
        options: { unscoped: true },
      })
      .populate("requestedHospitals.hospital", "name")
      .populate("acceptedByHospital", "name")
      .sort({ createdAt: -1 });

    console.log(
      `[Emergency] Found ${requests.length} requests for hospital ${hospitalId}`,
    );
    res.json({ requests });
  } catch (err) {
    console.error("Get hospital emergency requests error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Accept emergency request (Helpdesk)
export const acceptEmergencyRequest = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    if (!req.user || req.user.role !== "helpdesk") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { requestId } = req.params;
    const { notes } = req.body;

    const hospitalIdRaw = (req.user as any).hospital;
    if (!hospitalIdRaw) {
      return res.status(400).json({ message: "Hospital not found" });
    }
    const hospitalId = new mongoose.Types.ObjectId(hospitalIdRaw.toString());

    const emergencyRequest = await EmergencyRequest.findById(requestId);
    if (!emergencyRequest) {
      return res.status(404).json({ message: "Emergency request not found" });
    }

    // Check if already accepted by another hospital
    if (emergencyRequest.status === "accepted") {
      return res.status(400).json({
        message: "This request has already been accepted by another hospital",
      });
    }

    // Check if this hospital was requested
    const hospitalRequest = emergencyRequest.requestedHospitals.find(
      (rh) => rh.hospital.toString() === hospitalId.toString(),
    );

    if (!hospitalRequest) {
      return res.status(403).json({
        message: "This request was not sent to your hospital",
      });
    }

    // Get hospital name for rejection reason
    const acceptedHospital = await Hospital.findById(hospitalId);
    const hospitalName = acceptedHospital
      ? acceptedHospital.name
      : "another hospital";

    // Update request
    emergencyRequest.status = "accepted";
    emergencyRequest.acceptedByHospital = hospitalId;
    emergencyRequest.acceptedByHelpdesk = req.user._id;
    emergencyRequest.acceptedAt = new Date();
    if (notes) emergencyRequest.notes = notes;

    // Update hospital-specific status
    hospitalRequest.status = "accepted";
    hospitalRequest.respondedAt = new Date();
    hospitalRequest.respondedBy = req.user._id;

    // We no longer auto-reject other hospitals. They maintain their 'pending' state
    // until the mission is completed or they manually respond.
    // This allows the ambulance to see which hospitals are still potentially available/pending.

    await emergencyRequest.save();

    // Manually populate ambulancePersonnel using unscoped() to bypass tenantPlugin
    const acceptPopulatedPersonnel = await (
      AmbulancePersonnel.findById(emergencyRequest.ambulancePersonnel).select(
        "name vehicleNumber",
      ) as any
    ).unscoped();
    if (acceptPopulatedPersonnel) {
      (emergencyRequest as any).ambulancePersonnel = acceptPopulatedPersonnel;
    }
    await emergencyRequest.populate("acceptedByHospital", "name address");

    // 🔥 INSTANT UPDATE TO CREATOR
    emitEmergencyUpdateToCreator(req, emergencyRequest);

    res.json({
      message: "Emergency request accepted successfully",
      request: emergencyRequest,
    });
  } catch (err) {
    console.error("Accept emergency request error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Reject emergency request (Helpdesk)
export const rejectEmergencyRequest = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    if (!req.user || req.user.role !== "helpdesk") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { requestId } = req.params;
    const { rejectionReason } = req.body;

    const hospitalIdRaw = (req.user as any).hospital;
    if (!hospitalIdRaw) {
      return res.status(400).json({ message: "Hospital not found" });
    }
    const hospitalId = new mongoose.Types.ObjectId(hospitalIdRaw.toString());

    const emergencyRequest = await EmergencyRequest.findById(requestId);
    if (!emergencyRequest) {
      return res.status(404).json({ message: "Emergency request not found" });
    }

    // Check if this hospital was requested
    const hospitalRequest = emergencyRequest.requestedHospitals.find(
      (rh) => rh.hospital.toString() === hospitalId.toString(),
    );

    if (!hospitalRequest) {
      return res.status(403).json({
        message: "This request was not sent to your hospital",
      });
    }

    // Update hospital-specific status
    hospitalRequest.status = "rejected";
    hospitalRequest.respondedAt = new Date();
    hospitalRequest.respondedBy = req.user._id;
    hospitalRequest.rejectionReason =
      rejectionReason || "No capacity available";

    // Check if all hospitals rejected
    const allRejected = emergencyRequest.requestedHospitals.every(
      (rh) => rh.status === "rejected",
    );

    if (allRejected) {
      emergencyRequest.status = "rejected";
    }

    await emergencyRequest.save();

    // 🔥 INSTANT UPDATE TO CREATOR
    emitEmergencyUpdateToCreator(req, emergencyRequest);

    res.json({
      message: "Emergency request rejected",
      request: emergencyRequest,
    });
  } catch (err) {
    console.error("Reject emergency request error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all available hospitals
export const getAvailableHospitals = async (req: Request, res: Response) => {
  try {
    // Include both 'approved' and 'pending' — exclude only 'suspended'
    // Hospitals default to 'pending' on creation; filtering only 'approved'
    // would silently hide all hospitals in dev/staging environments
    const hospitals = await (Hospital.find({
      status: { $ne: "suspended" }
    }).select("name address phone email") as any);

    res.json({ hospitals });
  } catch (err) {
    console.error("Get available hospitals error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get dashboard stats for emergency
export const getEmergencyStats = async (req: AuthRequest, res: Response) => {
  try {
    const hospitalId = (req.user as any).hospital || req.query.hospitalId;
    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID is required" });
    }

    const stats = await emergencyService.getDashboardStats(hospitalId);
    res.json({ success: true, stats });
  } catch (err: any) {
    console.error("Get emergency stats error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
