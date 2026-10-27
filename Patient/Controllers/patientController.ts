import { Request, Response } from "express";
import PatientProfile from "../Models/PatientProfile.js";
import Patient from "../Models/Patient.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import PatientHospitalMap from "../Models/PatientHospitalMap.js";
import AuthLog from "../../Auth/Models/AuthLog.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import MobileAppointment from "../../Appointment/Models/MobileAppointment.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import LabToken from "../../Lab/Models/LabToken.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import { PatientRequest } from "../types/index.js";
import { IUser } from "../../Auth/types/index.js";
import redisService from "../../config/redis.js";

export const getProfile = async (req: Request, res: Response) => {
  const profileReq = req as unknown as PatientRequest;
  try {
    // Fetch ALL profiles for this user across all hospitals
    const profiles = await PatientProfile.find({ user: profileReq.user!._id })
      .populate("user", "name email mobile role age gender avatar height weight bloodGroup address allergies conditions emergencyContactName emergencyContactPhone emergencyContactRelation dateOfBirth dob fatherName GuardianName guardianName honorific")
      .populate("hospital", "name address logo");

    if (!profiles || profiles.length === 0) {
      // Return a basic profile shell based on the user record if no hospital profile exists yet
      // CRITICAL: Fetch full patient document as req.user only contains token payload!
      const user = await Patient.findById(profileReq.user!._id);
      if (!user) return res.status(404).json({ message: "User not found" });

      return res.json({
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          role: user.role,
          age: user.age,
          gender: user.gender,
          dateOfBirth: user.dateOfBirth,
          dob: user.dob,
          fatherName: (user as any).fatherName || (user as any).GuardianName,
          GuardianName: (user as any).GuardianName || (user as any).fatherName,
          guardianName: (user as any).guardianName || (user as any).fatherName,
          height: user.height,
          weight: user.weight,
          bloodGroup: user.bloodGroup,
          address: user.address,
          allergies: user.allergies,
          conditions: user.conditions,
          emergencyContactName: user.emergencyContactName,
          emergencyContactPhone: user.emergencyContactPhone,
          emergencyContactRelation: user.emergencyContactRelation,
        },
        mrn: "N/A",
        status: "active",
      });
    }

    // Return the first profile for this user
    res.json(profiles[0]);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const updateProfile = async (req: Request, res: Response) => {
  const updateReq = req as unknown as PatientRequest;
  try {
    const { name, email, dob, ...profileData } = updateReq.body;

    // Update Patient model if identity or global fields are provided
    const avatarInput = updateReq.body.avatar || updateReq.body.profilePic || updateReq.body.image;
    if (
      name || email || dob || avatarInput ||
      updateReq.body.mobile || updateReq.body.age || updateReq.body.gender ||
      updateReq.body.height || updateReq.body.weight || updateReq.body.address ||
      updateReq.body.bloodGroup || updateReq.body.allergies || updateReq.body.conditions ||
      updateReq.body.emergencyContactName || updateReq.body.emergencyContactPhone || updateReq.body.emergencyContactRelation
    ) {
      const updates: any = {};
      if (name) updates.name = name;
      if (email) updates.email = email;
      if (avatarInput) updates.avatar = avatarInput;
      if (updateReq.body.mobile) updates.mobile = updateReq.body.mobile;
      if (updateReq.body.age) updates.age = Number(updateReq.body.age);
      if (updateReq.body.gender) updates.gender = updateReq.body.gender;
      
      // Clinical & Contact Global Updates
      if (updateReq.body.height)    updates.height    = Number(updateReq.body.height);
      if (updateReq.body.weight)    updates.weight    = Number(updateReq.body.weight);
      if (updateReq.body.address)   updates.address   = updateReq.body.address;
      if (updateReq.body.bloodGroup) updates.bloodGroup = updateReq.body.bloodGroup;
      if (updateReq.body.allergies)  updates.allergies  = updateReq.body.allergies;
      if (updateReq.body.conditions) updates.conditions = updateReq.body.conditions;
      
      if (updateReq.body.emergencyContactName)     updates.emergencyContactName     = updateReq.body.emergencyContactName;
      if (updateReq.body.emergencyContactPhone)    updates.emergencyContactPhone    = updateReq.body.emergencyContactPhone;
      if (updateReq.body.emergencyContactRelation) updates.emergencyContactRelation = updateReq.body.emergencyContactRelation;
      
      if (updateReq.body.fatherName) {
        updates.fatherName = updateReq.body.fatherName;
        updates.GuardianName = updateReq.body.fatherName;
        updates.guardianName = updateReq.body.fatherName;
      }

      if (dob) {
        updates.dob = dob;
        const d = new Date(dob);
        if (!isNaN(d.getTime())) {
          updates.dateOfBirth = d;
          // Always recalculate age from DOB if DOB is provided for accuracy
          const ageMs = Date.now() - d.getTime();
          updates.age = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
        }
      }

      console.log(`[UpdateProfile] Updating Patient (User) collection for ID: ${updateReq.user!._id}`, updates);
      await (Patient as any).findByIdAndUpdate(updateReq.user!._id, { $set: updates });
    }

    // Update PatientProfile
    // .unscoped() is critical here because mobile requests often lack X-Hospital-Id
    let profile = await (PatientProfile as any).findOne({ user: updateReq.user!._id }).unscoped();
    
    if (profile) {
      console.log(`[UpdateProfile] Updating PatientProfile for ID: ${profile._id}`);
      const profileUpdates: any = { 
        ...profileData,
        // Sync these with the global user update
        address: updateReq.body.address,
        bloodGroup: updateReq.body.bloodGroup,
        emergencyContactName: updateReq.body.emergencyContactName,
        emergencyContactPhone: updateReq.body.emergencyContactPhone,
        emergencyContactRelation: updateReq.body.emergencyContactRelation,
        allergies: updateReq.body.allergies,
        conditions: updateReq.body.conditions,
        height: updateReq.body.height,
        weight: updateReq.body.weight,
      };
      if (dob) {
        const d = new Date(dob);
        if (!isNaN(d.getTime())) {
          profileUpdates.dob = d;
        }
      }

      profile = await (PatientProfile as any).findByIdAndUpdate(
        profile._id,
        { $set: profileUpdates },
        { new: true }
      ).unscoped().populate("user", "name email mobile role avatar age gender height weight bloodGroup address allergies conditions emergencyContactName emergencyContactPhone emergencyContactRelation");
    } else {
      // If no profile exists, return updated user info with all fields
      const updatedUser = await (Patient as any).findById(updateReq.user!._id).select("name email mobile role avatar age gender dateOfBirth height weight bloodGroup address allergies conditions emergencyContactName emergencyContactPhone emergencyContactRelation");
      return res.json({
        user: updatedUser,
        message: "Identity updated. Visit a hospital to complete clinical profile."
      });
    }

    res.json(profile);
  } catch (err: any) {
    console.error("[UpdateProfile Error]:", err);
    if (err.code === 11000) {
      if (err.keyPattern && err.keyPattern.mobile) {
        return res.status(400).json({
          message:
            "This phone number is already registered with another user. Please select another phone number.",
        });
      }
      return res.status(400).json({ message: "Duplicate field value entered" });
    }
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getPatientProfileById = async (req: Request, res: Response) => {
  try {
    // Check if user exists first
    const user = await Patient.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const profile = await PatientProfile.findOne({
      user: req.params.id,
    }).populate("user", "name email mobile role");

    // If profile doesn't exist, return basic user info with empty fields
    if (!profile) {
      return res.json({
        user: user,
        height: "",
        weight: "",
        medications: "",
        address: "",
        gender: "",
        dob: "",
      });
    }

    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Search patients by name, MRN, or mobile
export const searchPatients = async (req: Request, res: Response) => {
  try {
    const { query, hospital } = req.query;

    if (!query || typeof query !== "string") {
      return res.json({ patients: [] });
    }

    // Resolve hospital: explicit param > authenticated user's hospital
    const hospitalId = hospital || (req as any).user?.hospital;

    // Clean query for mobile search (remove non-digits)
    const mobileQuery = query.replace(/\D/g, "");

    const searchFilter: any = {
      $or: [
        { name: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
        // Add mobile search
        ...(mobileQuery.length > 3
          ? [{ mobile: { $regex: mobileQuery, $options: "i" } }]
          : []),
      ],
    };

    if (hospitalId) {
      searchFilter.hospitals = hospitalId;
    } else {
      searchFilter.hospitals = { $exists: true };
    }

    const patients = await Patient.find(searchFilter)
      .select("_id name mobile email age ageUnit gender address")
      .limit(10)
      .lean();

    const patientIds = patients.map(p => p._id);

    // Fetch MRN and Address from PatientProfiles
    const profiles = await PatientProfile.find({
      user: { $in: patientIds }
    }).select("user mrn address").lean();

    const mrnMap = new Map();
    const addressMap = new Map();
    for (const prof of profiles) {
      if (prof.user) {
        mrnMap.set(prof.user.toString(), prof.mrn);
        if (prof.address) {
          addressMap.set(prof.user.toString(), prof.address);
        }
      }
    }

    // Check active IPD admissions with doctor info
    const activeAdmissions = await IPDAdmission.find({
      patient: { $in: patientIds },
      status: "Active"
    }).select("patient primaryDoctor").populate({
      path: "primaryDoctor",
      select: "user",
      populate: { path: "user", select: "name" }
    }).lean();

    const ipdMap = new Map<string, string>();
    const doctorMap = new Map<string, string>();
    for (const adm of activeAdmissions) {
      const pid = adm.patient.toString();
      ipdMap.set(pid, "IPD");
      const doc = adm.primaryDoctor as any;
      if (doc?.user?.name) {
        doctorMap.set(pid, doc.user.name);
      }
    }

    // For OPD patients, fetch latest appointment with doctor
    const opdPatientIds = patientIds.filter(id => !ipdMap.has(id.toString()));
    if (opdPatientIds.length > 0) {
      const latestAppointments = await Appointment.aggregate([
        { $match: { patient: { $in: opdPatientIds } } },
        { $sort: { date: -1 } },
        { $group: { _id: "$patient", doctor: { $first: "$doctor" } } }
      ]);

      if (latestAppointments.length > 0) {
        const DoctorProfile = (await import("../../Doctor/Models/DoctorProfile.js")).default;
        const doctorIds = latestAppointments.map(a => a.doctor).filter(Boolean);
        const doctors = await DoctorProfile.find({ _id: { $in: doctorIds } })
          .select("_id user")
          .populate("user", "name")
          .lean();
        const docProfileMap = new Map();
        for (const d of doctors) {
          docProfileMap.set(d._id.toString(), (d.user as any)?.name || "");
        }
        for (const appt of latestAppointments) {
          if (appt.doctor) {
            const docName = docProfileMap.get(appt.doctor.toString());
            if (docName) doctorMap.set(appt._id.toString(), docName);
          }
        }
      }
    }

    const enrichedPatients = patients.map(p => {
      const patientIdStr = p._id.toString();
      return {
        ...p,
        address: p.address || addressMap.get(patientIdStr) || "",
        mrn: mrnMap.get(patientIdStr) || "N/A",
        patientType: ipdMap.has(patientIdStr) ? "IPD" : "OPD",
        doctorName: doctorMap.get(patientIdStr) || "",
      };
    });

    res.json({ patients: enrichedPatients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get patient details with bed/room information
export const getPatientWithBedInfo = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;

    console.log(
      "[getPatientWithBedInfo] Fetching bed info for patient:",
      patientId,
    );

    // Get user (Patient)
    const user = await Patient.findById(patientId).select("_id name mobile");
    if (!user) {
      console.log("[getPatientWithBedInfo] Patient not found");
      return res.status(404).json({ message: "Patient not found" });
    }

    console.log("[getPatientWithBedInfo] Patient found:", {
      name: (user as any).name,
      id: user._id,
    });

    // Get patient profile to fetch MRN
    const patientProfile = await PatientProfile.findOne({
      user: patientId,
    }).select("mrn");
    const mrnNumber = patientProfile?.mrn || "Not Found";

    console.log("[getPatientWithBedInfo] Patient profile MRN:", mrnNumber);

    // Get active admission
    const admission = await IPDAdmission.findOne({
      patient: patientId,
      status: "Active",
    });

    console.log(
      "[getPatientWithBedInfo] Admission found:",
      admission ? admission._id : "None",
    );

    if (!admission) {
      return res.json({
        patient: user,
        mrnNumber: mrnNumber,
        bedNumber: "Not Found",
        roomNumber: "Not Found",
        message: "No active admission found",
      });
    }

    // Get bed occupancy with populated bed details
    const occupancy = await BedOccupancy.findOne({
      admission: admission._id,
      endDate: null,
    }).populate("bed");

    console.log(
      "[getPatientWithBedInfo] Occupancy found:",
      occupancy ? "Yes" : "No",
    );
    console.log("[getPatientWithBedInfo] Bed details:", occupancy?.bed);

    const bed: any = occupancy?.bed;

    const response = {
      patient: user,
      mrnNumber: mrnNumber,
      bedNumber: bed?.bedId || "Not Found", // Changed from bedNumber to bedId
      roomNumber: bed?.room || "Not Found",
    };

    console.log("[getPatientWithBedInfo] Returning response:", response);

    res.json(response);
  } catch (err) {
    console.error("[getPatientWithBedInfo] Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteAccount = async (req: Request, res: Response) => {
  const profileReq = req as unknown as PatientRequest;
  try {
    const userId = profileReq.user!._id;

    console.log(`[DeleteAccount] Deleting all data for user: ${userId}`);

    // 1. Delete all PatientProfiles (unscoped to catch all hospitals)
    await (PatientProfile as any).deleteMany({ user: userId }).unscoped();

    // 2. Delete PatientHospitalMap entries
    await (PatientHospitalMap as any).deleteMany({ globalPatientId: userId });

    // 3. Delete AuthLogs
    await (AuthLog as any).deleteMany({ user: userId });

    // 4. Delete Clinical Records
    await (Appointment as any).deleteMany({ patient: userId }).unscoped();
    await (MobileAppointment as any).deleteMany({ patient: { $in: [userId] } }).unscoped(); // MobileAppointment often uses profile IDs, but we can try user ID too or just rely on profiles being gone
    await (Prescription as any).deleteMany({ patient: userId }).unscoped();
    await (LabToken as any).deleteMany({ patient: userId }).unscoped();
    await (LabOrder as any).deleteMany({ patient: userId }).unscoped();

    // 5. Delete Patient (User) record (unscoped)
    await (Patient as any).findByIdAndDelete(userId).unscoped();

    // 5. Clear auth cache
    const cacheKey = `auth:user:v2:${userId}`;
    await redisService.del(cacheKey);

    console.log(`[DeleteAccount] Successfully deleted user: ${userId}`);

    res.json({
      success: true,
      message: "Your account and all associated profile data have been permanently deleted.",
    });
  } catch (err) {
    console.error("[DeleteAccount] Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error while deleting account. Please try again later.",
    });
  }
};

/**
 * GET /api/patients/family-members
 * Fetches all patients and dependents registered under the SAME mobile number as current user.
 * Even if they have different names, DOBs, genders, and MRNs!
 */
export const getFamilyMembers = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const currentUserId = patientReq.user?._id;
    if (!currentUserId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // 1. Find current user to retrieve primary mobile number
    let currentUser: any = await (Patient.findById(currentUserId) as any).unscoped();
    if (!currentUser) {
      const User = (await import("../../Auth/Models/User.js")).default;
      currentUser = await (User.findById(currentUserId) as any).unscoped();
    }

    if (!currentUser || !currentUser.mobile) {
      return res.status(404).json({ success: false, message: "User mobile not found" });
    }

    const cleanMobile = currentUser.mobile.trim();

    // 2. Query ALL patients sharing this exact mobile number (unscoped)
    const linkedPatients = await (Patient.find({
      $or: [
        { mobile: cleanMobile },
        { emergencyContactPhone: cleanMobile },
      ],
      status: { $ne: "suspended" },
    }) as any).unscoped().select(
      "name mobile gender age ageUnit dateOfBirth bloodGroup address allergies conditions emergencyContactName emergencyContactPhone emergencyContactRelation avatar createdAt"
    ).lean();

    // 3. Collect MRNs and primary hospital details for each linked patient
    const patientIds = linkedPatients.map((p: any) => p._id);
    const profiles = await (PatientProfile.find({
      user: { $in: patientIds },
    }) as any).unscoped().populate("hospital", "name address logo").lean();

    const profileMap = new Map<string, any>();
    profiles.forEach((prof: any) => {
      const uId = prof.user?.toString();
      if (!profileMap.has(uId) || prof.mrn) {
        profileMap.set(uId, prof);
      }
    });

    // 4. Structure response with relationship tags and primary indicators
    const members = linkedPatients.map((p: any) => {
      const prof = profileMap.get(p._id.toString());
      const isCurrent = p._id.toString() === currentUserId.toString();
      
      let relationship = "Family Member";
      if (isCurrent) {
        relationship = "Self";
      } else if (p.emergencyContactRelation) {
        relationship = p.emergencyContactRelation;
      }

      return {
        _id: p._id.toString(),
        name: p.name,
        mobile: p.mobile,
        gender: p.gender || "Unknown",
        age: p.age ?? (p.dateOfBirth ? Math.floor((Date.now() - new Date(p.dateOfBirth).getTime()) / (365.25 * 86400000)) : undefined),
        ageUnit: p.ageUnit || "Years",
        dateOfBirth: p.dateOfBirth,
        bloodGroup: p.bloodGroup || prof?.bloodGroup || "Unknown",
        mrn: prof?.mrn || `MSC-${p._id.toString().slice(-6).toUpperCase()}`,
        hospital: prof?.hospital || null,
        allergies: p.allergies || "",
        conditions: p.conditions || "",
        relationship,
        isCurrent,
        avatar: p.avatar || prof?.avatar || "",
      };
    });

    // Sort: current/primary user first, then by creation date
    members.sort((a: any, b: any) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0));

    return res.json({
      success: true,
      count: members.length,
      primaryMobile: cleanMobile,
      members,
    });
  } catch (err: any) {
    console.error("[getFamilyMembers] Error:", err);
    return res.status(500).json({ success: false, message: "Server error retrieving family profiles" });
  }
};

/**
 * POST /api/patients/family-members
 * Adds a new family dependent (Child, Spouse, Parent) sharing the same mobile number.
 */
export const addFamilyMember = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const currentUserId = patientReq.user?._id;
    let currentUser: any = await (Patient.findById(currentUserId) as any).unscoped();
    if (!currentUser) {
      const User = (await import("../../Auth/Models/User.js")).default;
      currentUser = await (User.findById(currentUserId) as any).unscoped();
    }

    if (!currentUser || !currentUser.mobile) {
      return res.status(404).json({ success: false, message: "Primary patient mobile not found" });
    }

    const { name, gender, dateOfBirth, age, ageUnit, bloodGroup, relationship, allergies, conditions } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Family member full name is required" });
    }

    const cleanMobile = currentUser.mobile.trim();
    let parsedDob: Date | undefined;
    if (dateOfBirth) {
      const d = new Date(dateOfBirth);
      if (!isNaN(d.getTime())) parsedDob = d;
    }

    // 1. Create Patient in MongoDB under the same mobile number
    const newPatient = await Patient.create({
      name: name.trim(),
      mobile: cleanMobile,
      gender: gender || "Other",
      dateOfBirth: parsedDob,
      age: Number(age) || (parsedDob ? Math.floor((Date.now() - parsedDob.getTime()) / (365.25 * 86400000)) : undefined),
      ageUnit: ageUnit || "Years",
      bloodGroup: bloodGroup || "Unknown",
      allergies: allergies || "",
      conditions: conditions || "",
      role: "patient",
      status: "active",
      emergencyContactName: currentUser.name,
      emergencyContactPhone: cleanMobile,
      emergencyContactRelation: relationship || "Family Member",
      hospitals: currentUser.hospitals || [],
    });

    // 2. Generate MRN & Create PatientProfile for primary hospital
    const primaryHospital = currentUser.hospital || currentUser.hospitals?.[0] || req.headers["x-hospital-id"];
    let mrn = `MSC-${newPatient._id.toString().slice(-6).toUpperCase()}`;
    if (primaryHospital && primaryHospital !== "global") {
      try {
        const { generateMrn } = await import("../../utils/idGenerator.js");
        mrn = await generateMrn(primaryHospital);
      } catch (mrnErr) {
        console.warn("[addFamilyMember] MRN generation fallback:", mrnErr);
      }
    }

    await PatientProfile.create({
      user: newPatient._id,
      hospital: primaryHospital && primaryHospital !== "global" ? primaryHospital : undefined,
      mrn,
      gender: gender?.toLowerCase(),
      dob: parsedDob,
      bloodGroup: bloodGroup || "Unknown",
      contactNumber: cleanMobile,
      GuardianName: currentUser.name,
      GuardianRelation: relationship || "Primary Contact",
      GuardianMobile: cleanMobile,
    });

    return res.status(201).json({
      success: true,
      message: `${name} has been added to your family health circle`,
      member: {
        _id: newPatient._id.toString(),
        name: newPatient.name,
        mobile: newPatient.mobile,
        gender: newPatient.gender,
        age: newPatient.age,
        dateOfBirth: newPatient.dateOfBirth,
        bloodGroup: newPatient.bloodGroup,
        mrn,
        relationship: relationship || "Family Member",
        isCurrent: false,
      },
    });
  } catch (err: any) {
    console.error("[addFamilyMember] Error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to add family member" });
  }
};

/**
 * POST /api/patients/switch-profile/:patientId
 * Switches active context to another family member sharing the same mobile number.
 * Returns fresh authentication tokens so all app routes re-scope immediately.
 */
export const switchFamilyMember = async (req: Request, res: Response) => {
  const patientReq = req as unknown as PatientRequest;
  try {
    const currentUserId = patientReq.user?._id;
    const targetPatientId = req.params.patientId || req.body.patientId;

    if (!targetPatientId) {
      return res.status(400).json({ success: false, message: "Target patient ID is required" });
    }

    // 1. Fetch current user
    let currentUser: any = await (Patient.findById(currentUserId) as any).unscoped();
    if (!currentUser) {
      const User = (await import("../../Auth/Models/User.js")).default;
      currentUser = await (User.findById(currentUserId) as any).unscoped();
    }

    if (!currentUser) {
      return res.status(404).json({ success: false, message: "Current patient not found" });
    }

    // 2. Fetch target family member
    const targetPatient: any = await (Patient.findById(targetPatientId) as any).unscoped();
    if (!targetPatient) {
      return res.status(404).json({ success: false, message: "Target family member not found" });
    }

    // 3. Security Check: Allow switch if:
    //    (a) Same mobile number (primary member), OR
    //    (b) Target's mobile is empty/undefined (dependent added via family), OR
    //    (c) Target's emergencyContactPhone matches current user's mobile (linked family)
    //    (d) The target's mobile matches current user's mobile
    const currentMobile = (currentUser.mobile || "").replace(/\D/g, "");
    const targetMobile = (targetPatient.mobile || "").replace(/\D/g, "");
    const targetEmergency = (targetPatient.emergencyContactPhone || "").replace(/\D/g, "");

    const sameMobile = currentMobile && targetMobile && currentMobile === targetMobile;
    const targetIsDependent = !targetMobile; // dependent added via Add Family Member (no own mobile)
    const emergencyMatches = currentMobile && targetEmergency && currentMobile === targetEmergency;

    // Also check if there is a PatientProfile for the target that was linked to this user's mobile
    let profileLinkVerified = false;
    if (!sameMobile && !targetIsDependent && !emergencyMatches) {
      // Check if they share any hospital and both are patients
      // This verifies the target was genuinely added as a family member from this account
      try {
        const targetProfileCheck = await (PatientProfile.findOne({ user: targetPatient._id }) as any).unscoped().lean();
        const currentProfileCheck = await (PatientProfile.findOne({ user: currentUser._id }) as any).unscoped().lean();
        if (
          targetProfileCheck && currentProfileCheck &&
          targetProfileCheck.hospital?.toString() === currentProfileCheck.hospital?.toString()
        ) {
          // Check if they share the same mobile (via profile or patient)
          const profileMobiles = [
            (targetProfileCheck as any)?.contactNumber,
            (targetProfileCheck as any)?.alternateNumber,
            (targetPatient as any)?.emergencyContactPhone,
          ].map((m: any) => (m || "").replace(/\D/g, "")).filter(Boolean);
          profileLinkVerified = profileMobiles.some((m: string) => m === currentMobile);
        }
      } catch (profileCheckErr) {
        console.warn("[switchFamilyMember] Profile link check error:", profileCheckErr);
      }
    }

    if (!sameMobile && !targetIsDependent && !emergencyMatches && !profileLinkVerified) {
      console.warn(`[switchFamilyMember] Mobile mismatch: current=${currentMobile} target=${targetMobile} emergency=${targetEmergency}`);
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Profile is not linked to this family mobile number",
      });
    }

    // 4. Generate tokens for the target family member
    const { handleAuthResponse } = await import("../../Auth/Controllers/authController.js");
    const { tokenService } = await import("../../Auth/Services/tokenService.js");

    const targetHosp = (targetPatient.hospital || targetPatient.hospitals?.[0] || req.headers["x-hospital-id"] || "global").toString();
    const { accessToken, refreshToken, csrfToken } = await handleAuthResponse(res, targetPatient, req, targetHosp);

    // Fetch target MRN
    const targetProfile = await (PatientProfile.findOne({ user: targetPatient._id }) as any).unscoped().lean();

    return res.json({
      success: true,
      message: `Switched active profile to ${targetPatient.name}`,
      accessToken,
      refreshToken,
      csrfToken,
      tokens: { accessToken, refreshToken, csrfToken },
      accessTokenExpiresIn: tokenService.getAccessExpirySeconds(),
      refreshTokenExpiresIn: tokenService.getRefreshExpirySeconds(),
      user: {
        id: targetPatient._id.toString(),
        name: targetPatient.name,
        role: "patient",
        mobile: targetPatient.mobile,
        gender: targetPatient.gender,
        age: targetPatient.age,
        dateOfBirth: targetPatient.dateOfBirth,
        bloodGroup: targetPatient.bloodGroup || (targetProfile as any)?.bloodGroup || "Unknown",
        mrn: (targetProfile as any)?.mrn || `MSC-${targetPatient._id.toString().slice(-6).toUpperCase()}`,
        hospitals: targetPatient.hospitals,
        avatar: targetPatient.avatar || (targetProfile as any)?.avatar || "",
      },
    });
  } catch (err: any) {
    console.error("[switchFamilyMember] Error:", err?.message || err);
    return res.status(500).json({ success: false, message: "Server error switching profile context" });
  }
};

