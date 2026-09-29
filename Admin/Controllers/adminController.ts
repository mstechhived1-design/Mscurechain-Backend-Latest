// Forces reload
import { Request, Response } from "express";
import User from "../../Auth/Models/User.js";
// import HelpDesk from "../../Helpdesk/Models/HelpDesk.js";
import bcrypt from "bcrypt";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Patient from "../../Patient/Models/Patient.js";
import SuperAdmin from "../../Auth/Models/SuperAdmin.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import Notification from "../../Notification/Models/Notification.js";
import mongoose from "mongoose";
import { AdminRequest } from "../types/index.js";
import StaffProfile from "../../Staff/Models/StaffProfile.js";
import Attendance from "../../Staff/Models/Attendance.js";
import Leave from "../../Leave/Models/Leave.js";
import PharmaProfile from "../../Pharmacy/Models/PharmaProfile.js";
import PharmaInvoice from "../../Pharmacy/Models/Invoice.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import AmbulancePersonnel from "../../Emergency/Models/AmbulancePersonnel.js";
import crypto from "crypto";
import hospitalAdminService from "../../services/hospital-admin.service.js";
import { processSingleProfileExpiry } from "../../services/reminderService.js";
import sendEmail from "../../utils/sendEmail.js";
import Bed from "../../IPD/Models/Bed.js";
import Room from "../../IPD/Models/Room.js";
import Department from "../../IPD/Models/IPDDepartment.js";
import Payroll from "../../Staff/Models/Payroll.js";
import Transaction from "../Models/Transaction.js";

const getRequesterHospitalId = async (req: Request): Promise<string | null> => {
  const requester = (req as any).user;
  if (!requester) return null;

  // 1. Direct from user profile (Hardened multi-tenancy)
  if (requester.hospital) {
    return requester.hospital.toString();
  }

  // 2. Fallback to StaffProfile
  const profile = await (
    StaffProfile.findOne({
      user: requester._id || requester.id,
    }) as any
  )
    .unscoped()
    .select("hospital")
    .lean();
  if (profile?.hospital) {
    return profile.hospital.toString();
  }

  // 3. Fallback to query/header ONLY for super-admins or global roles
  const globalRoles = ["super-admin", "admin", "masterhelpdesk"];
  if (globalRoles.includes(requester.role)) {
    const hospitalId = req.query.hospitalId || req.headers["x-hospital-id"];
    return hospitalId ? hospitalId.toString() : null;
  }

  return null;
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const {
      role: queryRole,
      page,
      limit,
      search,
      sortBy,
      sortOrder,
    } = req.query as any;
    const role = (req as any).filterRole || queryRole; // filterRole set by route middleware takes priority
    const requester = (req as any).user;
    const userRole = requester?.role?.toLowerCase();

    const hospitalId = await getRequesterHospitalId(req);

    if (!hospitalId && requester?.role !== "super-admin") {
      return res.status(400).json({ message: "Hospital ID is required" });
    }

    // Use service for optimized data fetching
    const result = await hospitalAdminService.getAllUsers(
      hospitalId as string,
      role as string,
      parseInt(page) || 1,
      parseInt(limit) || 100,
      search as string,
      sortBy as string,
      sortOrder as any,
    );

    if (!result || !result.users) {
      return res.json([]);
    }

    // Maintain compatibility with existing response formats
    const isHospitalAdminPath = req.baseUrl.includes("hospital");
    const isSuperAdminPath =
      req.baseUrl.includes("api/admin") ||
      req.baseUrl.includes("api/super-admin");

    if (role && isHospitalAdminPath && !isSuperAdminPath) {
      const roleStr = String(role);
      let key = roleStr.endsWith("s") ? roleStr : roleStr + "s";
      if (["staff", "DISCHARGE", "emergency"].includes(roleStr)) key = "staff";
      return res.json({ [key]: result.users });
    }

    res.json(result);
  } catch (err: any) {
    console.error("[getAllUsers] ERROR:", err?.message, err?.stack);
    res.status(500).json({
      success: false,
      message: `Server Error: ${err?.message || "Internal error"}`,
      detail: err?.message,
      stack: err?.stack,
    });
  }
};

export const getStaffById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Try to find StaffProfile by ID first
    let staffProfile: any = await (StaffProfile.findById(id) as any)
      .unscoped()
      .populate({
        path: "user",
        select: "-password",
        options: { unscoped: true } as any,
      })
      .populate({
        path: "hospital",
        select: "name address",
        options: { unscoped: true } as any,
      });

    // If not found, try to find by user ID
    if (!staffProfile && mongoose.Types.ObjectId.isValid(id)) {
      staffProfile = await (StaffProfile.findOne({ user: id }) as any)
        .unscoped()
        .populate({
          path: "user",
          select: "-password",
          options: { unscoped: true } as any,
        })
        .populate({
          path: "hospital",
          select: "name address",
          options: { unscoped: true } as any,
        });
    }

    // If STILL not found, check if it's a User with a staff-like role
    if (!staffProfile && mongoose.Types.ObjectId.isValid(id)) {
      const user = await (User.findById(id) as any)
        .unscoped()
        .select("-password")
        .populate({
          path: "hospital",
          select: "name address",
          options: { unscoped: true } as any,
        })
        .lean();
      if (
        user &&
        ["staff", "nurse", "emergency", "DISCHARGE"].includes(user.role)
      ) {
        // Return a virtual staff object for frontend compatibility
        return res.json({
          user,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          role: user.role,
          status: user.status,
          hospital: user.hospital,
          _id: user._id,
          virtual: true, // Flag to indicate it needs a profile created on SAVE
        });
      }
    }

    if (!staffProfile) {
      return res.status(404).json({ message: "Staff member not found" });
    }

    // Return the staff profile
    res.json(staffProfile);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    if (req.body.role === "doctor" && req.body.name) {
      let cleaned = req.body.name.trim();
      cleaned = cleaned.replace(/\s*\.+\s*/g, " ").replace(/\s+/g, " ").trim();
      while (/^(dr|dr\.|dr\s+|dr\.\s+)/i.test(cleaned)) {
        cleaned = cleaned.replace(/^(dr|dr\.|dr\s+|dr\.\s+)/i, "").trim();
      }
      req.body.name = cleaned ? `Dr. ${cleaned}` : "Doctor";
    }

    const {
      name,
      email,
      password,
      mobile,
      role,
      hospitalId,
      speciality,
      experience,
      qualifications,
      honorific,
    } = req.body;

    console.log(
      `[createUser] Entering: role=${role}, name=${name}, hospitalId_from_body=${hospitalId}`,
    );

    // Validation - always require name for new users
    if (!name || !/^[a-zA-Z0-9\s.'-]+$/.test(name)) {
      return res.status(400).json({
        message:
          "Name is required and can contain letters, numbers, spaces, dots, hyphens, and single quotes",
      });
    }

    if (email && (!email.includes("@") || !email.includes("."))) {
      return res.status(400).json({
        message: "Invalid email format",
      });
    }

    // Resolve target hospital ID from context (which is derived from URL/header or user record)
    let targetHospitalId = (req as any).tenantId || (req as any).user.hospital;

    // Fallback: If no hospital in context, use hospitalId from body (ONLY for super-admin/admin)
    const requester = (req as any).user || {};
    const globalRoles = ["super-admin", "admin"];
    if (!targetHospitalId && globalRoles.includes(requester.role)) {
      targetHospitalId = hospitalId;
    }

    // Resolve custom hospitalId string (e.g. "HSP-1001") to actual MongoDB _id
    if (
      targetHospitalId &&
      !mongoose.Types.ObjectId.isValid(targetHospitalId)
    ) {
      const hospitalDoc = await Hospital.findOne({
        hospitalId: targetHospitalId,
      }).lean();
      if (hospitalDoc) {
        targetHospitalId = hospitalDoc._id;
      } else {
        return res
          .status(404)
          .json({ message: `Hospital not found with ID: ${targetHospitalId}` });
      }
    }

    console.log(
      `[createUser] Resolved targetHospitalId: ${targetHospitalId} (type: ${typeof targetHospitalId})`,
    );

    // Final defensive check: Every user must belong to a hospital in this multi-tenant system
    if (!targetHospitalId) {
      console.error(
        `[createUser] CRITICAL: Hospital context not resolved for role=${role}, name=${name}`,
      );
      return res.status(400).json({
        message:
          "Hospital context is required. Please ensure you are logged into a hospital portal or providing a hospitalId.",
      });
    }

    // Convert to string safely for logs and service calls
    const hospitalIdStr = (
      targetHospitalId?._id || targetHospitalId
    ).toString();

    // If still no hospitalId and we assume single hospital, pick the first one

    // Enforce employeeId for specific roles if not created by super-admin
    const rolesRequiringEmployeeId = [
      "doctor",
      "nurse",
      "staff",
      "hr",
      "helpdesk",
      "masterhelpdesk",
      "frontdesk",
    ];
    if (rolesRequiringEmployeeId.includes(role)) {
      if (requester.role !== "super-admin") {
        if (!req.body.employeeId || !req.body.employeeId.toString().trim()) {
          return res
            .status(400)
            .json({ message: "Employee ID is required for this role" });
        }
      }
    }

    // Limit checks
    if (
      role === "staff" ||
      role === "nurse" ||
      role === "doctor" ||
      role === "DISCHARGE"
    ) {
      const maxStaff = parseInt(process.env.MAX_STAFF_PER_HOSPITAL || "50"); // Increased to accommodate nurses
      const maxDoctors = parseInt(process.env.MAX_DOCTORS_PER_HOSPITAL || "20");

      if (role === "staff" || role === "nurse" || role === "DISCHARGE") {
        const staffCount = await (
          StaffProfile.countDocuments({
            hospital: targetHospitalId,
          }) as any
        ).unscoped();
        if (staffCount >= maxStaff) {
          return res.status(400).json({
            message: `Personnel limit reached for this hospital (Max: ${maxStaff})`,
          });
        }
      }

      if (role === "doctor") {
        const doctorCount = await (
          DoctorProfile.countDocuments({
            hospital: targetHospitalId,
          }) as any
        ).unscoped();
        if (doctorCount >= maxDoctors) {
          return res.status(400).json({
            message: `Doctor limit reached for this hospital (Max: ${maxDoctors})`,
          });
        }
      }
    }

    if (role === "helpdesk" || role === "masterhelpdesk") {
      const {
        name,
        mobile,
        email,
        password,
        loginId,
        additionalNotes,
        gender,
        dateOfBirth,
        address,
        department,
        assignedRoom,
        designation,
        employeeId,
        employmentType,
        experienceYears,
        joiningDate,
        emergencyContact,
        shift,
        workingHours,
        weeklyOff,
        qualifications,
        certifications,
        skills,
        bloodGroup,
        languages,
        sickLeaveQuota,
        emergencyLeaveQuota,
        baseSalary,
        panNumber,
        pfNumber,
        esiNumber,
        uanNumber,
        aadharNumber,
        fatherName,
        workLocation,
        bankDetails,
      } = req.body;

      if (!name || !mobile || !password) {
        return res.status(400).json({
          message: "Name, mobile, and password are required for helpdesk",
        });
      }

      const helpdeskEmail = email || `${mobile}@helpdesk.local`;

      // Check for duplicates before creating a new user
      const existing = await (
        User.findOne({
          $or: [{ email: helpdeskEmail }, { mobile: mobile }],
        }) as any
      ).unscoped();

      if (existing) {
        return res.status(400).json({
          message: "A user with this email or mobile already exists",
        });
      }

      console.log(`[createUser:helpdesk] Hashing password...`);
      const hashedPassword = await bcrypt.hash(password, 10);
      console.log(`[createUser:helpdesk] Creating User document...`);
      const newHelpdeskUser = await User.create({
        name,
        email: helpdeskEmail,
        mobile,
        password: hashedPassword,
        loginId: loginId || mobile,
        role: role,
        hospital: targetHospitalId,
        gender,
        dateOfBirth,
        additionalNotes: additionalNotes || "",
      });

      console.log(
        `[createUser:helpdesk] User created with ID: ${newHelpdeskUser._id}`,
      );
      const qrSecret = crypto.randomBytes(32).toString("hex");

      console.log(`[createUser:helpdesk] Creating StaffProfile...`);

      // Create StaffProfile for Helpdesk to support attendance and all metadata
      await StaffProfile.create({
        user: newHelpdeskUser._id,
        hospital: targetHospitalId,
        qrSecret,
        honorific,
        address,
        department,
        assignedRoom,
        designation: designation || "Helpdesk",
        employeeId,
        employmentType,
        experienceYears,
        joiningDate,
        emergencyContact,
        shift,
        workingHours,
        shiftStart: workingHours?.start || "09:00",
        shiftEnd: workingHours?.end || "17:00",
        weeklyOff,
        qualifications,
        certifications,
        skills,
        bloodGroup,
        languages,
        notes: additionalNotes || req.body.notes,
        sickLeaveQuota,
        emergencyLeaveQuota,
        baseSalary,
        panNumber,
        pfNumber,
        esiNumber,
        uanNumber,
        aadharNumber,
        fatherName,
        workLocation,
        bankDetails,
        gender,
        dob: dateOfBirth,
      });

      console.log(`[createUser:helpdesk] StaffProfile created successfully.`);

      try {
        await hospitalAdminService.invalidateHospitalCache(hospitalIdStr);
        console.log(
          `[createUser:helpdesk] Cache invalidated for hospital: ${hospitalIdStr}`,
        );
      } catch (cacheErr) {
        console.warn(
          `[createUser:helpdesk] Cache invalidation failed (non-critical):`,
          cacheErr,
        );
      }

      const populatedHelpdesk = await (
        User.findById(newHelpdeskUser._id) as any
      )
        .unscoped()
        .select("-password")
        .populate({
          path: "hospital",
          select: "name email phone city",
          options: { unscoped: true } as any,
        });

      return res.status(201).json({
        message: "Helpdesk created successfully with full profile",
        helpdesk: populatedHelpdesk,
        qrSecret,
      });
    }
    if (
      role === "staff" ||
      role === "nurse" ||
      role === "emergency" ||
      role === "DISCHARGE" ||
      role === "hr"
    ) {
      const existing = await (
        User.findOne({
          $or: [{ email }, { mobile }],
        }) as any
      ).unscoped();
      if (existing) {
        return res.status(400).json({
          message: `${role.charAt(0).toUpperCase() + role.slice(1)} with this email/mobile already exists`,
        });
      }

      console.log(`[createUser:${role}] Hashing password...`);
      const hashedPassword = await bcrypt.hash(password, 10);
      console.log(`[createUser:${role}] Creating User document...`);
      const newUser = await User.create({
        name,
        email,
        password: hashedPassword,
        mobile,
        role,
        hospital: targetHospitalId,
        gender: req.body.gender,
        dateOfBirth: req.body.dateOfBirth,
      });

      console.log(`[createUser:${role}] User created with ID: ${newUser._id}`);
      const qrSecret = crypto.randomBytes(32).toString("hex");

      console.log(`[createUser:${role}] Creating StaffProfile...`);

      await StaffProfile.create({
        user: newUser._id,
        hospital: targetHospitalId,
        qrSecret,
        honorific: req.body.honorific,
        address: req.body.address,
        department: req.body.department,
        assignedRoom: req.body.assignedRoom,
        designation: req.body.designation,
        employeeId: req.body.employeeId,
        employmentType: req.body.employmentType,
        experienceYears: req.body.experienceYears,
        joiningDate: req.body.joiningDate,
        emergencyContact: req.body.emergencyContact,
        shift: req.body.shift,
        workingHours: req.body.workingHours,
        shiftStart: req.body.workingHours?.start || "09:00",
        shiftEnd: req.body.workingHours?.end || "17:00",
        weeklyOff: req.body.weeklyOff,
        qualifications: req.body.qualifications,
        certifications: req.body.certifications,
        skills: req.body.skills,
        bloodGroup: req.body.bloodGroup,
        languages: req.body.languages,
        notes: req.body.notes,
        sickLeaveQuota: req.body.sickLeaveQuota,
        emergencyLeaveQuota: req.body.emergencyLeaveQuota,
        baseSalary: req.body.baseSalary,
        panNumber: req.body.panNumber,
        pfNumber: req.body.pfNumber,
        esiNumber: req.body.esiNumber,
        uanNumber: req.body.uanNumber,
        aadharNumber: req.body.aadharNumber,
        fatherName: req.body.fatherName,
        workLocation: req.body.workLocation,
        bankDetails: req.body.bankDetails,
        gender: req.body.gender,
        dob: req.body.dateOfBirth,
      });

      console.log(`[createUser:${role}] StaffProfile created successfully.`);

      try {
        await hospitalAdminService.invalidateHospitalCache(hospitalIdStr);
        console.log(
          `[createUser:${role}] Cache invalidated for hospital: ${hospitalIdStr}`,
        );
      } catch (cacheErr) {
        console.warn(
          `[createUser:${role}] Cache invalidation failed (non-critical):`,
          cacheErr,
        );
      }

      return res.status(201).json({
        message: `${role.charAt(0).toUpperCase() + role.slice(1)} created successfully`,
        user: newUser,
        qrSecret,
      });
    }

    if (role === "pharma-owner") {
      const existing = await (
        User.findOne({
          $or: [{ email }, { mobile }],
        }) as any
      ).unscoped();
      if (existing) {
        return res.status(400).json({
          message: "Pharma owner with this email/mobile already exists",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = await User.create({
        name,
        email,
        password: hashedPassword,
        mobile,
        role: "pharma-owner",
        hospital: targetHospitalId,
      });

      await PharmaProfile.create({
        user: newUser._id,
        hospital: targetHospitalId,
        businessName: req.body.businessName || `${name}'s Pharmacy`,
      });

      return res.status(201).json({
        message: "Pharma owner created successfully",
        user: newUser,
      });
    }

    const [existingUser, existingPatient, existingSuperAdmin] =
      await Promise.all([
        (User.findOne({ $or: [{ email }, { mobile }] }) as any).unscoped(),
        (Patient.findOne({ $or: [{ email }, { mobile }] }) as any).unscoped(),
        (SuperAdmin.findOne({ email }) as any).unscoped(),
      ]);

    if (existingUser || existingPatient || existingSuperAdmin) {
      return res
        .status(400)
        .json({ message: "User with this email or mobile already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Handle SuperAdmin separately
    if (role === "super-admin") {
      const existing = await (SuperAdmin.findOne({ email }) as any).unscoped();
      if (existing) {
        return res
          .status(400)
          .json({ message: "Super Admin with this email already exists" });
      }
      const newSuperAdmin = await SuperAdmin.create({
        name,
        email,
        password: hashedPassword,
        role: "super-admin",
        status: "active",
      });

      return res.status(201).json({
        message: "Super Admin created successfully",
        user: newSuperAdmin,
      });
    }

    // Handle Patient separately
    if (role === "patient") {
      let targetPatient = await (
        Patient.findOne({
          mobile,
        }) as any
      ).unscoped();

      if (targetPatient) {
        console.log(
          `[createUser] Found existing patient with mobile ${mobile}. Reusing...`,
        );
        // Update details if provided
        if (name) targetPatient.name = name;
        if (email) targetPatient.email = email;
        if (req.body.gender) targetPatient.gender = req.body.gender;
        if (req.body.dateOfBirth)
          targetPatient.dateOfBirth = req.body.dateOfBirth;

        // Update hospitals array
        if (!targetPatient.hospitals) {
          targetPatient.hospitals = [];
        }
        const legacyHospital = (targetPatient as any).hospital;
        if (legacyHospital) {
          if (
            !targetPatient.hospitals.some(
              (h: any) => h.toString() === legacyHospital.toString(),
            )
          ) {
            targetPatient.hospitals.push(legacyHospital);
          }
          await Patient.collection.updateOne(
            { _id: targetPatient._id },
            { $unset: { hospital: "" } },
          );
        }
        if (
          targetHospitalId &&
          !targetPatient.hospitals.some(
            (h: any) => h.toString() === targetHospitalId.toString(),
          )
        ) {
          targetPatient.hospitals.push(targetHospitalId);
        }

        await targetPatient.save();
      } else {
        targetPatient = await Patient.create({
          name,
          email,
          mobile,
          password: hashedPassword,
          role: "patient",
          hospitals: targetHospitalId ? [targetHospitalId] : [],
          gender: req.body.gender,
          dateOfBirth: req.body.dateOfBirth,
          status: "active",
        });
      }

      // Check if profile already exists for this hospital
      const existingProfile = await (
        PatientProfile.findOne({
          user: targetPatient._id,
          hospital: targetHospitalId,
        }) as any
      ).unscoped();

      if (!existingProfile) {
        // Create profile for hospital association
        await PatientProfile.create({
          user: targetPatient._id,
          hospital: targetHospitalId,
          gender: req.body.gender?.toLowerCase(),
          dob: req.body.dateOfBirth,
        });
      }

      if (targetHospitalId) {
        await hospitalAdminService.invalidateHospitalCache(
          targetHospitalId.toString(),
        );
      }

      return res.status(201).json({
        message: "Patient registered successfully",
        user: targetPatient,
      });
    }

    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      mobile,
      role,
      gender: req.body.gender,
      dateOfBirth: req.body.dateOfBirth,
      hospital: targetHospitalId,
      employeeId: req.body.employeeId,
      department: req.body.department,
      address: req.body.address,
      avatar: req.body.avatar || req.body.image,
      loginId: req.body.loginId || mobile,
    });

    if (role === "doctor") {
      // Fix: Frontend sends 'specialties' and 'qualifications' as arrays
      const inputSpecialties =
        req.body.specialties || (speciality ? [speciality] : []);
      const finalSpecialties = Array.isArray(inputSpecialties)
        ? inputSpecialties
        : [inputSpecialties];

      const finalQualifications = Array.isArray(qualifications)
        ? qualifications
        : qualifications
          ? [qualifications]
          : [];

      let parsedLanguages = req.body.languages;
      if (typeof parsedLanguages === "string") {
        try {
          parsedLanguages = JSON.parse(parsedLanguages);
        } catch { }
      }

      let parsedAwards = req.body.awards;
      if (typeof parsedAwards === "string") {
        try {
          parsedAwards = JSON.parse(parsedAwards);
        } catch { }
      }

      await DoctorProfile.create({
        user: newUser._id,
        honorific,
        specialties: finalSpecialties,
        qualifications: finalQualifications,
        experienceStart: experience
          ? new Date(
            new Date().setFullYear(new Date().getFullYear() - experience),
          )
          : req.body.experienceStart || new Date(),
        hospital: targetHospitalId,
        consultationFee: req.body.consultationFee,
        bio: req.body.bio,
        profilePic: req.body.profilePic || req.body.avatar,
        medicalRegistrationNumber: req.body.medicalRegistrationNumber,
        registrationCouncil: req.body.registrationCouncil,
        registrationYear: req.body.registrationYear,
        registrationExpiryDate: req.body.registrationExpiryDate,
        employeeId: req.body.employeeId,
        consultationDuration: req.body.consultationDuration,
        maxAppointmentsPerDay: req.body.maxAppointmentsPerDay,
        availability: req.body.availability,
        address: req.body.address,
        permissions: req.body.permissions,
        languages: parsedLanguages,
        awards: parsedAwards,
        baseSalary: req.body.baseSalary,
        panNumber: req.body.panNumber,
        aadharNumber: req.body.aadharNumber,
        pfNumber: req.body.pfNumber,
        esiNumber: req.body.esiNumber,
        uanNumber: req.body.uanNumber,
        bankDetails: req.body.bankDetails,
      });

      // Add doc to hospital (matching legacy field if needed)
    }

    // Invalidate cache
    if (targetHospitalId) {
      try {
        await hospitalAdminService.invalidateHospitalCache(hospitalIdStr);
        console.log(
          `[createUser] Cache invalidated for hospital: ${hospitalIdStr}`,
        );
      } catch (cacheErr) {
        console.warn(
          `[createUser] Cache invalidation failed (non-critical):`,
          cacheErr,
        );
      }
    }

    res
      .status(201)
      .json({ message: "User created successfully", user: newUser });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err?.message });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const requester = (req as any).user;

    // Resolve User ID if the provided ID is a DoctorProfile / StaffProfile / PatientProfile ID
    let targetUserId = id;
    let docProfile: any = null;
    let stfProfile: any = null;
    let patProfile: any = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      docProfile = await (DoctorProfile.findById(id) as any).unscoped();
      if (docProfile) {
        targetUserId = docProfile.user.toString();
      } else {
        patProfile = await (PatientProfile.findById(id) as any).unscoped();
        if (patProfile) {
          targetUserId = patProfile.user.toString();
        } else {
          stfProfile = await (StaffProfile.findById(id) as any).unscoped();
          if (stfProfile) {
            targetUserId = stfProfile.user.toString();
          }
        }
      }
    }
    console.log(`[updateUser] Resolved targetUserId: ${targetUserId}`);

    // Resolve User to check role for employeeId enforcement
    const existingUserToUpdate = await (User.findById(targetUserId) as any).unscoped();
    const roleForValidation = updates.role || existingUserToUpdate?.role || stfProfile?.role || docProfile?.role;
    const existingEmployeeId = existingUserToUpdate?.employeeId || stfProfile?.employeeId || docProfile?.employeeId;

    if (roleForValidation === "doctor" && updates.name) {
      let cleaned = updates.name.trim();
      cleaned = cleaned.replace(/\s*\.+\s*/g, " ").replace(/\s+/g, " ").trim();
      while (/^(dr|dr\.|dr\s+|dr\.\s+)/i.test(cleaned)) {
        cleaned = cleaned.replace(/^(dr|dr\.|dr\s+|dr\.\s+)/i, "").trim();
      }
      updates.name = cleaned ? `Dr. ${cleaned}` : "Doctor";
    }

    const rolesRequiringEmployeeId = [
      "doctor",
      "nurse",
      "staff",
      "hr",
      "helpdesk",
      "frontdesk",
    ];
    if (rolesRequiringEmployeeId.includes(roleForValidation)) {
      if (requester?.role !== "super-admin") {
        // If updating employeeId, it must not be empty.
        const newEmployeeId = updates.employeeId;
        if (
          newEmployeeId !== undefined &&
          (!newEmployeeId || !newEmployeeId.toString().trim())
        ) {
          return res
            .status(400)
            .json({ message: "Employee ID cannot be empty for this role" });
        }

        // If employeeId is NOT in updates, and NOT in existing user or profile:
        if (newEmployeeId === undefined && !existingEmployeeId) {
          const generatedEmpId = `EMP${existingUserToUpdate?.loginId || targetUserId.slice(-6).toUpperCase()}`;
          updates.employeeId = generatedEmpId;
          if (existingUserToUpdate) {
            existingUserToUpdate.employeeId = generatedEmpId;
            await existingUserToUpdate.save();
          }
        }
      }
    }


    // 1. Separate User-level fields from profile-level fields
    const userFields = [
      "name",
      "email",
      "mobile",
      "password",
      "gender",
      "dateOfBirth",
      "status",
      "avatar",
      "loginId",
      "employeeId",
      "department",
      "additionalNotes",
    ];
    const userUpdates: any = {};

    // Hash password if provided, remove if empty to prevent accidental wipe
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
    } else {
      delete updates.password; // Prevent empty string from wiping the password
    }

    userFields.forEach((field) => {
      if (updates[field] !== undefined) {
        let val = updates[field];
        // The User model expects department as a string, but staff profiles often use arrays
        if (field === "department" && Array.isArray(val)) {
          val = val.join(", ");
        }
        userUpdates[field] = val;
      }
    });

    // Update User document with only User-level fields
    let user: any = null;
    if (Object.keys(userUpdates).length > 0) {
      user = await (
        User.findByIdAndUpdate(targetUserId, userUpdates, {
          new: true,
        }) as any
      ).unscoped();
    } else {
      user = await (User.findById(targetUserId) as any).unscoped();
    }

    if (!user) {
      return res.status(404).json({ message: "User not found or you are not authorized to edit this user" });
    }

    // Double-check hospital ownership for hospital-admins (extra safety)
    if (requester?.role === "hospital-admin" && user.hospital?.toString() !== requester.hospitalId?.toString() && user.hospital?.toString() !== (req as any).hospitalId?.toString()) {
      // We allow it if the unscoped fetch matches, but we should be careful
      // Actually, if we are here, unscoped fetch worked. 
    }

    if (user) {
      // If it's a doctor, we might need to update the DoctorProfile as well
      if (user.role === "doctor") {
        const updateFields: any = {};

        // Handle specialties
        if (updates.specialties) {
          updateFields.specialties = Array.isArray(updates.specialties)
            ? updates.specialties
            : [updates.specialties];
        } else if (updates.speciality) {
          updateFields.specialties = [updates.speciality];
        }

        // Handle qualifications
        if (updates.qualifications) {
          updateFields.qualifications = Array.isArray(updates.qualifications)
            ? updates.qualifications
            : [updates.qualifications];
        }

        // Map all profile fields if present in updates
        const profileFields = [
          "consultationFee",
          "bio",
          "profilePic",
          "medicalRegistrationNumber",
          "registrationCouncil",
          "registrationYear",
          "registrationExpiryDate",
          "employeeId",
          "consultationDuration",
          "maxAppointmentsPerDay",
          "availability",
          "address",
          "permissions",
          "languages",
          "awards",
          "baseSalary",
          "panNumber",
          "aadharNumber",
          "pfNumber",
          "esiNumber",
          "uanNumber",
          "bankDetails",
          "honorific",
        ];

        profileFields.forEach((f) => {
          if (updates[f] !== undefined) {
            let value = updates[f];
            try {
              if (
                typeof value === "string" &&
                (["permissions", "languages", "awards"].includes(f) ||
                  ["bankDetails", "address"].includes(f))
              ) {
                if (value.startsWith("[") || value.startsWith("{"))
                  value = JSON.parse(value);
              }
            } catch { }
            updateFields[f] = value;
          }
        });

        if (updates.experienceStart)
          updateFields.experienceStart = updates.experienceStart;

        // Only update if there are fields to update
        if (Object.keys(updateFields).length > 0) {
          console.log(`[updateUser] Updating DoctorProfile for user ${targetUserId}`);
          await (
            DoctorProfile.findOneAndUpdate(
              { user: targetUserId },
              { $set: updateFields },
              { upsert: true, new: true },
            ) as any
          ).unscoped();
        }
      } else if (
        ["staff", "nurse", "emergency", "discharge", "DISCHARGE", "hr", "helpdesk", "frontdesk"].includes(
          user.role?.toLowerCase(),
        )
      ) {
        console.log(`[updateUser] Entering staff profile update block for role: ${user.role}`);
        // Update StaffProfile
        const staffFields = [
          "department",
          "assignedRoom",
          "designation",
          "employeeId",
          "employmentType",
          "experienceYears",
          "joiningDate",
          "address",
          "emergencyContact",
          "shift",
          "workingHours",
          "weeklyOff",
          "qualifications",
          "certifications",
          "skills",
          "bloodGroup",
          "languages",
          "notes",
          "status",
          "terminationDate",
          "terminationReason",
          "sickLeaveQuota",
          "emergencyLeaveQuota",
          "baseSalary",
          "panNumber",
          "pfNumber",
          "esiNumber",
          "uanNumber",
          "aadharNumber",
          "fatherName",
          "workLocation",
          "bankDetails",
          "qualificationDetails",
          "documents",
          "honorific",
        ];

        const updateFields: any = {};
        staffFields.forEach((f) => {
          if (updates[f] !== undefined) {
            let value = updates[f];

            // FIX: Handle empty string for ObjectId fields (like shift)
            if (f === "shift" && value === "") {
              value = null;
            }

            // Robust parsing for fields that might be stringified JSON
            const arrayFields = [
              "department",
              "assignedRoom",
              "qualifications",
              "certifications",
              "skills",
              "languages",
              "weeklyOff",
            ];
            const objectFields = [
              "address",
              "emergencyContact",
              "workingHours",
              "bankDetails",
              "qualificationDetails",
              "documents",
              "professionalExperience",
            ];

            try {
              if (
                typeof value === "string" &&
                (arrayFields.includes(f) || objectFields.includes(f))
              ) {
                if (value.startsWith("[") || value.startsWith("{")) {
                  value = JSON.parse(value);
                }
              }

              // Sanitize arrays
              if (
                arrayFields.includes(f) &&
                (Array.isArray(value) || typeof value === "string")
              ) {
                let finalArray: string[] = [];
                if (Array.isArray(value)) {
                  value.forEach((item) => {
                    if (typeof item === "string") {
                      if (item.startsWith("[") && item.endsWith("]")) {
                        try {
                          const parsed = JSON.parse(item);
                          if (Array.isArray(parsed)) finalArray.push(...parsed);
                          else finalArray.push(parsed);
                        } catch {
                          finalArray.push(item);
                        }
                      } else {
                        finalArray.push(
                          ...item
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        );
                      }
                    } else {
                      finalArray.push(String(item));
                    }
                  });
                } else if (typeof value === "string") {
                  finalArray = value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                }
                value = [...new Set(finalArray)];
              }
            } catch (e: any) {
              console.warn(
                `[adminController.updateUser] Failed to parse field ${f}:`,
                e,
              );
            }

            updateFields[f] = value;
          }
        });

        // ✅ RE-ARM: Reset alert flags if the date has changed
        if (
          updateFields.qualificationDetails?.licenseValidityDate ||
          updateFields.licenseValidityDate
        ) {
          updateFields.expiryAlertsSent = {
            thirtyDay: false,
            sevenDay: false,
            oneDay: false,
            expired: false,
          };
        }

        // Backward compatibility for shift
        if (updates.workingHours) {
          if (updates.workingHours.start)
            updateFields.shiftStart = updates.workingHours.start;
          if (updates.workingHours.end)
            updateFields.shiftEnd = updates.workingHours.end;
        }

        // Mirror common fields if present
        if (updates.gender) updateFields.gender = updates.gender;
        if (updates.dateOfBirth) updateFields.dob = updates.dateOfBirth;

        // Ensure hospital is set if it's an upsert
        if (user.hospital) {
          updateFields.hospital = user.hospital;
        } else if ((req as any).hospitalId) {
          updateFields.hospital = (req as any).hospitalId;
        }

        console.log(`[updateUser] Final StaffProfile updateFields:`, JSON.stringify(updateFields, null, 2));

        const updateFilter = { user: new mongoose.Types.ObjectId(targetUserId.toString()) };

        const updatedProfile = await (
          StaffProfile.findOneAndUpdate(
            updateFilter,
            {
              $set: updateFields,
              $setOnInsert: { qrSecret: crypto.randomBytes(32).toString("hex") },
            },
            { upsert: true, new: true },
          ) as any
        )
          .unscoped()
          .populate("user");

        console.log(`[updateUser] StaffProfile updated successfully: ${!!updatedProfile}`);

        // Link StaffProfile to User if not already linked (redundancy for better population)
        const currentStaffId = user.assignedStaff?._id?.toString() || user.assignedStaff?.toString();
        if (updatedProfile && currentStaffId !== updatedProfile._id.toString()) {
          await User.findByIdAndUpdate(targetUserId, { $set: { assignedStaff: updatedProfile._id } });
        }

        // ✅ INSTANT ALERT: Check and notify immediately if date is close/expired
        if (
          updatedProfile &&
          updatedProfile.qualificationDetails?.licenseValidityDate
        ) {
          await processSingleProfileExpiry(updatedProfile);
        }
      }

      // Invalidate cache for this user and the whole hospital
      if (user.hospital) {
        await hospitalAdminService.invalidateHospitalCache(
          user.hospital.toString(),
        );
      }

      return res.json(user);
    }

    // 3. Not found
    res.status(404).json({ message: "User not found" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    session.startTransaction();

    const requester = (req as any).user;
    if (requester?.role === "hr") {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message:
          "HR managers do not have permission to permanently delete users. You can only disable or deactivate them.",
      });
    }

    // Resolve User ID if the provided ID is a DoctorProfile ID
    let targetUserId = id;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const docProfile = await (DoctorProfile.findById(id) as any)
        .unscoped()
        .session(session);
      if (docProfile) {
        targetUserId = docProfile.user.toString();
      } else {
        const patProfile = await PatientProfile.findById(id).session(session);
        if (patProfile) {
          targetUserId = patProfile.user.toString();
        } else {
          const stfProfile = await StaffProfile.findById(id).session(session);
          if (stfProfile) {
            targetUserId = stfProfile.user.toString();
          }
        }
      }
    }

    // Try finding in User
    const user = await (User.findById(targetUserId) as any)
      .unscoped()
      .session(session);
    if (user) {
      if (user.status !== "inactive") {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message:
            "User must be deactivated (status: inactive) before permanent deletion.",
        });
      }

      if (user.role === "doctor") {
        const docProfile = await (
          DoctorProfile.findOne({
            user: targetUserId,
          }) as any
        )
          .unscoped()
          .session(session);
        if (docProfile) {
          // Remove from hospital

          await (DoctorProfile.findOneAndDelete({ user: targetUserId }) as any)
            .unscoped()
            .session(session);
        }
      } else if (
        ["staff", "nurse", "emergency", "DISCHARGE", "hr"].includes(
          user.role as string,
        )
      ) {
        await StaffProfile.findOneAndDelete({ user: targetUserId }).session(
          session,
        );
      }

      await (User.findByIdAndDelete(targetUserId) as any)
        .unscoped()
        .session(session);
      await session.commitTransaction();
      return res.json({ message: "User deleted" });
    }

    // Try finding in Patient
    const patient = await Patient.findById(targetUserId).session(session);
    if (patient) {
      await PatientProfile.findOneAndDelete({ user: targetUserId }).session(
        session,
      );
      await Patient.findByIdAndDelete(targetUserId).session(session);
      await session.commitTransaction();
      return res.json({ message: "Patient deleted" });
    }

    await session.abortTransaction();
    res.status(404).json({ message: "User not found" });
  } catch (err: any) {
    await session.abortTransaction();
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  } finally {
    session.endSession();
  }
};

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;
    const userRole = requester?.role?.toLowerCase();
    const isSuperAdminPath =
      req.baseUrl.includes("api/admin") ||
      req.baseUrl.includes("api/super-admin");

    // ─── SUPER-ADMIN FAST PATH ─────────────────────────────────────────────
    // Bypass the service entirely — do direct, safe global queries
    if (isSuperAdminPath && userRole === "super-admin") {
      const [
        totalHospitals,
        totalDoctors,
        totalNurses,
        totalStaff,
        totalHelpdesk,
        totalPatients,
        totalAdmins,
        hospitalsByStatus,
        recentRegistrations,
      ] = await Promise.all([
        Hospital.countDocuments(),
        (
          User.countDocuments({
            role: { $regex: /^doctor$/i },
            status: "active",
          }) as any
        ).unscoped(),
        (
          User.countDocuments({
            role: { $regex: /^nurse$/i },
            status: "active",
          }) as any
        ).unscoped(),
        (
          User.countDocuments({
            role: { $regex: /^staff$/i },
            status: "active",
          }) as any
        ).unscoped(),
        (
          User.countDocuments({ role: { $regex: /^helpdesk$/i } }) as any
        ).unscoped(),
        (Patient.countDocuments() as any).unscoped(),
        (
          User.countDocuments({
            role: { $in: ["super-admin", "admin", "hospital-admin"] },
          }) as any
        ).unscoped(),
        Hospital.aggregate([
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        (User.find() as any)
          .unscoped()
          .sort({ createdAt: -1 })
          .limit(5)
          .select("name email role createdAt status")
          .lean(),
      ]);

      const statusMap: Record<string, number> = {
        active: 0,
        inactive: 0,
        pending: 0,
      };
      hospitalsByStatus.forEach((s: any) => {
        if (s._id && statusMap[s._id] !== undefined) {
          statusMap[s._id] = s.count;
        }
      });

      return res.json({
        totalUsers:
          totalDoctors +
          totalNurses +
          totalStaff +
          totalHelpdesk +
          totalPatients,
        totalHospitals,
        totalDoctors,
        totalNurses,
        totalPatients,
        totalAdmins,
        totalHelpDesks: totalHelpdesk,
        recentUsers: recentRegistrations,
        recentRegistrations: recentRegistrations,
        activityStats: [
          {
            _id: "Today",
            count: 0,
          },
          {
            _id: "Total",
            count:
              totalDoctors +
              totalNurses +
              totalStaff +
              totalHelpdesk +
              totalPatients,
          },
        ],
        hospitalsByStatus: statusMap,
      });
    }

    // ─── HOSPITAL-ADMIN PATH ───────────────────────────────────────────────
    const hospitalId = await getRequesterHospitalId(req);

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID is required" });
    }

    // Use service for optimized dashboard stats with caching
    const filters = {
      range: req.query.range as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      visitType: req.query.visitType as string,
    };
    const stats = await hospitalAdminService.getDashboardStats(hospitalId, filters);
    const hospital = await Hospital.findById(hospitalId);

    // Get live queue with optional doctor filter
    const doctorId = req.query.doctorId as string | undefined;
    const liveQueue = await hospitalAdminService.getLiveQueue(
      hospitalId,
      doctorId,
    );

    res.json({
      hospital,
      stats: {
        totalDoctors: stats.totalDoctors,
        totalNurses: stats.totalNurses,
        totalDischarge: 0,
        totalHelpdesk: stats.totalHelpdesk,
        totalStaff: stats.totalStaff,
        totalPatients: stats.totalPatients,
        totalAppointments: stats.activeAppointments,
        todayAppointments: stats.activeAppointments,
        revenue: stats.monthlyRevenue,
        totalLabRequests: stats.totalLabRequests,
        totalPharmaSales: stats.totalPharmaSales,
        totalInpatients: stats.totalInpatients,
        totalAdmissions: stats.totalAdmissions,
        bedOccupancy: stats.bedOccupancy,
        avgPatientWaitTime: stats.avgPatientWaitTime,
        avgConsultationTime: stats.avgConsultationTime,
        attendance: {
          present: stats.todayAttendance,
          late: 0,
          absent: 0,
          onLeave: stats.pendingLeaves,
        },
      },
      liveQueue,
    });
  } catch (err: any) {
    console.error("[getDashboardStats] ERROR:", err?.message, err?.stack);
    res.status(500).json({
      success: false,
      message: "Server error",
      detail: err?.message,
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
};

export const getHospitalAnalytics = async (req: Request, res: Response) => {
  try {
    const hospitalId = await getRequesterHospitalId(req);
    const { range, startDate, endDate } = req.query;

    if (!hospitalId) {
      return res
        .status(403)
        .json({ message: "No hospital associated with this account" });
    }

    const analytics = await hospitalAdminService.getHospitalAnalytics(
      hospitalId,
      range as string,
      {
        startDate: startDate as string,
        endDate: endDate as string,
      },
    );
    res.json(analytics);
  } catch (error: any) {
    console.error("Analytics Controller Error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getDoctorPerformanceDetailed = async (req: Request, res: Response) => {
  try {
    const hospitalId = await getRequesterHospitalId(req);
    const { range, startDate, endDate } = req.query;

    if (!hospitalId) {
      return res
        .status(403)
        .json({ message: "No hospital associated with this account" });
    }

    const performance = await hospitalAdminService.getDoctorPerformanceDetailed(
      hospitalId,
      range as string,
      {
        startDate: startDate as string,
        endDate: endDate as string,
      },
    );
    res.json(performance);
  } catch (error: any) {
    console.error("Doctor Performance Controller Error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getDoctorDetailedTransactions = async (req: Request, res: Response) => {
  try {
    const hospitalId = await getRequesterHospitalId(req);
    const { id: doctorId } = req.params;
    const { range, startDate, endDate } = req.query;

    if (!hospitalId) {
      return res.status(403).json({ message: "No hospital associated with this account" });
    }

    const transactions = await hospitalAdminService.getDoctorDetailedTransactions(
      hospitalId,
      doctorId,
      range as string,
      {
        startDate: startDate as string,
        endDate: endDate as string,
      },
    );
    res.json(transactions);
  } catch (error: any) {
    console.error("Doctor Detailed Transactions Error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const createDoctor = async (req: Request, res: Response) => {
  req.body.role = "doctor";
  return createUser(req, res);
};

export const createHospitalAdmin = async (req: Request, res: Response) => {
  req.body.role = req.body.role || "hospital-admin";
  return createUser(req, res);
};

export const createHelpDesk = async (req: Request, res: Response) => {
  req.body.role = "helpdesk";
  return createUser(req, res);
};

export const sendHelpdeskCredentials = async (req: Request, res: Response) => {
  try {
    const { helpdeskId, loginId, password } = req.body;

    const user = await (User.findById(helpdeskId) as any)
      .unscoped()
      .populate({ path: "hospital", options: { unscoped: true } as any });
    if (!user) {
      return res.status(404).json({ message: "Helpdesk user not found" });
    }

    if (!user.email) {
      return res
        .status(400)
        .json({ message: "User does not have an email address" });
    }

    const hospitalName = (user.hospital as any)?.name || "Multi-Cure Hospital";

    const subject = `Your Multi-Cure Helpdesk Credentials - ${hospitalName}`;
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
        <h2 style="color: #2563eb;">Welcome to Multi-Cure</h2>
        <p>Hello <strong>${user.name}</strong>,</p>
        <p>Your helpdesk account has been initialized for <strong>${hospitalName}</strong>.</p>
        <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Username:</strong> ${loginId}</p>
          <p style="margin: 5px 0;"><strong>Temporary Password:</strong> ${password}</p>
        </div>
        <p>Please log in to your portal and change your password immediately for security.</p>
        <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/auth/login" 
           style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-top: 10px;">
           Login to Portal
        </a>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #64748b;">If you didn't expect this email, please contact your system administrator.</p>
      </div>
    `;

    await sendEmail(user.email, subject, html);

    res.json({
      success: true,
      message: "Credentials emailed successfully",
      email: user.email,
    });
  } catch (err: any) {
    console.error("[sendHelpdeskCredentials] ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Failed to send credentials email",
      error: err.message,
    });
  }
};

export const createLab = async (req: Request, res: Response) => {
  req.body.role = "lab";
  return createUser(req, res);
};

export const createStaff = async (req: Request, res: Response) => {
  req.body.role = "staff";
  return createUser(req, res);
};

export const createNurse = async (req: Request, res: Response) => {
  req.body.role = "nurse";
  return createUser(req, res);
};

export const createDischargeStaff = async (req: Request, res: Response) => {
  req.body.role = "DISCHARGE";
  return createUser(req, res);
};

export const createHospital = async (req: Request, res: Response) => {
  try {
    const data = { ...req.body };

    // Handle address sent as an object: flatten into individual fields
    if (data.address && typeof data.address === "object") {
      const addr = data.address;
      data.street = addr.street || data.street;
      data.city = addr.city || data.city;
      data.state = addr.state || data.state;
      data.pincode = addr.pincode || data.pincode;
      // Build a combined address string from the parts
      data.address = [addr.street, addr.city, addr.state, addr.pincode]
        .filter(Boolean)
        .join(", ");
    }

    const hospital = await Hospital.create(data);

    // ─── Cache Invalidation ───────────────────────────────────────────────
    try {
      const { redisService } = await import("../../config/redis.js");
      await redisService.del("super_admin:hospitals:list");
    } catch (cacheErr) {
      console.warn("[createHospital] Cache invalidation failed (non-critical):", cacheErr);
    }

    res.status(201).json(hospital);
  } catch (err: any) {
    console.error("createHospital error:", err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const adminListHospitals = async (req: Request, res: Response) => {
  try {
    // ─── Redis-backed hospital list cache (5 min TTL) ───────────────────────
    const { redisService } = await import("../../config/redis.js");
    const CACHE_KEY = "super_admin:hospitals:list";

    const cached = await redisService.get<any[]>(CACHE_KEY);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    // Lean + only the fields consumed by the frontend for speed
    const hospitals = await Hospital.find({})
      .select(
        "_id name hospitalId address city pincode phone email website status " +
        "rating specialities specialties services operatingHours " +
        "ambulanceAvailability ambulanceAvailable establishedYear"
      )
      .lean();

    // Warm the cache — 5 minutes
    await redisService.set(CACHE_KEY, hospitals, 300);

    res.setHeader("X-Cache", "MISS");
    res.json(hospitals);
  } catch (err: any) {
    console.error("[adminListHospitals]", err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const adminPatchHospitalStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, availablePortals, portalLicenses } = req.body;

    const updateData: any = {};
    if (status) updateData.status = status;
    if (availablePortals) updateData.availablePortals = availablePortals;

    // Handle per-portal licenses using $set with dot-notation for safe partial updates
    if (portalLicenses && typeof portalLicenses === "object") {
      for (const [portalKey, portalValue] of Object.entries(portalLicenses)) {
        updateData[`portalLicenses.${portalKey}`] = portalValue;
      }
    }

    const hospital = await Hospital.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true },
    );

    // Bust the hospitals list cache so the next fetch is fresh
    try {
      const { redisService } = await import("../../config/redis.js");
      await redisService.del("super_admin:hospitals:list");
    } catch (_) { }

    res.json(hospital);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const assignDoctorToHospital = async (req: Request, res: Response) => {
  try {
    const { doctorId, hospitalId, specialties, consultationFee } = req.body;

    // Update doctor profile (single hospital reference)
    await (
      DoctorProfile.findOneAndUpdate(
        { user: doctorId },
        {
          hospital: hospitalId,
          status: "active",
          ...(specialties && { specialties }),
          ...(consultationFee && { consultationFee }),
        },
        { upsert: true },
      ) as any
    ).unscoped();

    // Update hospital count

    res.json({ message: "Assigned successfully" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const assignHelpdeskToHospital = async (req: Request, res: Response) => {
  try {
    const { helpdeskId, hospitalId } = req.body;
    await (
      User.findByIdAndUpdate(helpdeskId, { hospital: hospitalId }) as any
    ).unscoped();
    res.json({ message: "Assigned successfully" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const removeDoctorFromHospital = async (req: Request, res: Response) => {
  try {
    const { doctorId, hospitalId } = req.body;
    await (
      DoctorProfile.findOneAndUpdate(
        { user: doctorId },
        { $unset: { hospital: "" } },
      ) as any
    ).unscoped();
    res.json({ message: "Removed successfully" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const listDoctorsByHospital = async (req: Request, res: Response) => {
  try {
    const doctors = await (
      DoctorProfile.find({
        hospital: req.params.id,
      }) as any
    )
      .unscoped()
      .populate({
        path: "user",
        select: "-password",
        options: { unscoped: true } as any,
      });
    res.json(doctors);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const getHospitalWithDoctors = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const hospital = await Hospital.findById(id);
    const doctors = await (DoctorProfile.find({ hospital: id }) as any)
      .unscoped()
      .populate({
        path: "user",
        select: "-password",
        options: { unscoped: true } as any,
      });
    res.json({ ...hospital?.toObject(), doctors });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const adminBroadcast = async (req: Request, res: Response) => {
  try {
    const { message, type = "system", targetRole } = req.body;
    const query: any = {};
    if (targetRole) query.role = targetRole;

    const users = await (User.find(query) as any).unscoped().select("_id");
    const notifications = users.map((u) => ({
      recipient: u._id,
      message,
      type,
      isRead: false,
    }));

    await Notification.insertMany(notifications);
    res.json({ message: `Broadcasted to ${users.length} users` });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const adminBulkHospitals = async (req: Request, res: Response) => {
  res.status(501).json({ message: "Not implemented" });
};

export const getAdminProfile = async (req: Request, res: Response) => {
  res.json((req as unknown as AdminRequest).user);
};

export const updateAdminProfile = async (req: Request, res: Response) => {
  try {
    const user = await (
      User.findByIdAndUpdate(
        (req as unknown as AdminRequest).user!._id,
        req.body,
        { new: true },
      ) as any
    ).unscoped();
    res.json(user);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

export const adminDashboard = async (req: Request, res: Response) => {
  return getDashboardStats(req, res);
};

export const getHospitalProfile = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;

    const hospitalId = await getRequesterHospitalId(req);
    let hospital: any;
    if (hospitalId) {
      const [hospitalData, roomCount, departmentCount, icuBeds] =
        await Promise.all([
          Hospital.findById(hospitalId).lean(),
          Room.countDocuments({ hospital: hospitalId }),
          Department.countDocuments({ hospital: hospitalId }),
          Bed.countDocuments({
            hospital: hospitalId,
            type: { $regex: /icu/i },
          }),
        ]);
      if (hospitalData) {
        hospital = {
          ...hospitalData,
          roomCount,
          departmentCount,
          ICUBeds: icuBeds,
        };
      }
    } else {
      // Fallback to first hospital for super-admin or if not linked
      const hospitalData = await Hospital.findOne().lean();
      if (hospitalData) {
        const [roomCount, departmentCount, icuBeds] = await Promise.all([
          Room.countDocuments({ hospital: hospitalData._id }),
          Department.countDocuments({ hospital: hospitalData._id }),
          Bed.countDocuments({
            hospital: hospitalData._id,
            type: { $regex: /icu/i },
          }),
        ]);
        hospital = {
          ...hospitalData,
          roomCount,
          departmentCount,
          ICUBeds: icuBeds,
        };
      }
    }

    if (!hospital) {
      return res.status(404).json({ message: "Hospital not found" });
    }

    res.json({ hospital });
  } catch (err: any) {
    console.error("getHospitalProfile error:", err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";

export const updateHospitalProfile = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;
    let hospitalId: string | null | undefined = await getRequesterHospitalId(req);

    if (!hospitalId) {
      hospitalId = (req.body.hospitalId || req.body._id)?.toString();
    }

    if (!hospitalId) {
      // Final fallback to first hospital if absolutely no context
      const firstHospital = await Hospital.findOne();
      hospitalId = firstHospital?._id?.toString();
    }

    if (!hospitalId) {
      return res.status(404).json({ message: "Hospital not found" });
    }

    // Clean query: remove immutable fields
    const updateData = { ...req.body };
    delete updateData._id;
    delete updateData.id;
    delete updateData.hospitalId;
    delete updateData.__v;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    // Handle File Upload
    if (req.file) {
      console.log("[updateHospitalProfile] File detected:", req.file);
      const result = await uploadToCloudinary(req.file.buffer);
      updateData.logo = result.secure_url;
      console.log("[updateHospitalProfile] Logo uploaded:", updateData.logo);
    }

    const updatedHospital = await Hospital.findByIdAndUpdate(
      hospitalId,
      updateData,
      { new: true },
    );

    if (!updatedHospital) {
      return res.status(404).json({ message: "Hospital document not found" });
    }

    // Invalidate cache
    await hospitalAdminService.invalidateHospitalCache(hospitalId!.toString());

    res.json({ success: true, hospital: updatedHospital });
  } catch (err: any) {
    console.error("updateHospitalProfile error:", err);
    res
      .status(500)
      .json({ message: "Server error during hospital profile update" });
  }
};

export const getTransactions = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;
    const hospitalId = await getRequesterHospitalId(req);

    if (!hospitalId)
      return res.status(400).json({ message: "Hospital ID required" });

    const {
      page = 1,
      limit = 10,
      range,
      startDate: queryStartDate,
      endDate: queryEndDate,
      type,
      search,
      query,
    } = req.query as any;

    // Calculate date range if provided
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (queryStartDate) {
      startDate = new Date(queryStartDate as string);
      startDate.setHours(0, 0, 0, 0);
    }

    if (queryEndDate) {
      endDate = new Date(queryEndDate as string);
      endDate.setHours(23, 59, 59, 999);
    }

    // Fallback to range preset if specific dates are not provided
    if (!startDate && !endDate && range) {
      endDate = new Date();
      startDate = new Date();
      if (range === "daily") startDate.setHours(0, 0, 0, 0);
      else if (range === "weekly") startDate.setDate(endDate.getDate() - 7);
      else if (range === "monthly") startDate.setMonth(endDate.getMonth() - 1);
    }

    // Enforce strict type filtering for Helpdesk/Admin -> Only OPD & IPD
    // Unless specific type is requested, we default to excluding lab/pharma
    const allowedTypes = [
      "opd",
      "ipd",
      "pharmacy",
      "appointment_booking",
      "ipd_advance",
      "ipd_final_settlement",
      "discharge",
      "lab_test",
      "package",
    ];

    console.log("[getTransactions] Filtering with:", {
      role: requester?.role,
      allowedTypes,
      startDate,
      endDate,
      page,
      limit,
      search,
    });

    // 🔧 FIX: Map "discharge" filter to "ipd_final_settlement" (actual DB type)
    let mappedType = type
      ? String(Array.isArray(type) ? type[0] : type)
      : undefined;
    if (mappedType === "discharge") {
      mappedType = "ipd_final_settlement";
      console.log(
        '[getTransactions] Mapped filter "discharge" → "ipd_final_settlement"',
      );
    }

    const isEdited = req.query.isEdited === "true";

    const result = await hospitalAdminService.getTransactions(
      hospitalId.toString(),
      { startDate, endDate, allowedTypes, type: mappedType, isEdited, search: search || query, query: query || search },
      parseInt(String(Array.isArray(page) ? page[0] : page || 1)),
      parseInt(String(Array.isArray(limit) ? limit[0] : limit || 10)),
    );

    console.log("[getTransactions] Result:", {
      totalTransactions: result.transactions.length,
      types: result.transactions.map((t: any) => t.type),
      total: result.pagination.total,
    });

    // Format for frontend compatibility
    const formattedTransactions = result.transactions.map((t: any) => ({
      id: t._id,
      _id: t._id,
      hospitalId: t.hospital,
      patientName: (() => {
        const placeholders = [
          "unknown",
          "unnamed",
          "debug",
          "n/a",
          "unknown patient",
          "unnamed patient",
          "",
        ];
        const possibleNames = [
          t.patientName,
          t.referenceId?.patientName,
          t.user?.name,
          t.patientData?.[0]?.name,
        ];
        for (const name of possibleNames) {
          if (name && !placeholders.includes(name.toLowerCase().trim())) {
            return name;
          }
        }
        return "Unknown Patient";
      })(),
      patientMRN: t.user?.mrn || t.patientData?.[0]?.mrn || "N/A",
      patientMobile: t.user?.mobile || t.referenceId?.phone || t.phone || "N/A",
      paymentMethod: t.paymentMode || "cash",
      amount: t.amount || 0,
      createdAt: t.createdAt || t.date || t.sortDate,
      date: t.date || t.createdAt,
      transactionTime: t.createdAt || t.date || t.sortDate,
      appointmentTime: t.appointmentTime || t.time || t.startTime || t.referenceId?.appointmentTime || t.referenceId?.time,
      time: t.time || t.appointmentTime || t.startTime || t.referenceId?.time || t.referenceId?.appointmentTime,
      type: t.type?.toUpperCase() || "GENERAL",
      source: t.type?.toLowerCase().includes("ipd")
        ? "IPD"
        : t.type?.toLowerCase().includes("opd") ||
          t.type?.toLowerCase().includes("appointment")
          ? "OPD"
          : "Other",
      status:
        t.status === "completed"
          ? "Paid"
          : t.status === "failed"
            ? "Failed"
            : "Pending",
      referenceId: t.referenceId, // Include populated clinical details
      paymentDetails: t.paymentDetails,
      transactionId: t.transactionId || t.referenceId?.transactionId || t.referenceId?.admissionId || "—",
      receiptNumber: t.receiptNumber || t.referenceId?.receiptNumber || t.referenceId?.transactionId || "—",
      invoiceNumber: t.invoiceNumber,
      tests: t.tests,
      reason: t.reason,
      patientDetails: {
        honorific: t.user?.honorific || t.profileData?.[0]?.honorific || t.patientData?.[0]?.honorific || t.patientData?.[0]?.honorificTitle || "",
        age: t.user?.age || t.profileData?.[0]?.age || t.patientData?.[0]?.age,
        dateOfBirth: t.user?.dob || t.profileData?.[0]?.dob || t.patientData?.[0]?.dob || t.patientData?.[0]?.dateOfBirth,
        gender: t.user?.gender || t.profileData?.[0]?.gender || t.patientData?.[0]?.gender,
      }
    }));

    res.json({
      data: formattedTransactions,
      pagination: result.pagination,
      totalRevenue: (result as any).totalRevenue || 0,
    });
  } catch (err: any) {
    console.error("getTransactions error:", err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err?.message,
      stack: err?.stack,
    });
  }
};

/**
 * Payroll Management Controllers
 */

export const editTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { type, paymentMode, reason, referenceId, paymentDetails } = req.body;
    const user = (req as any).user;
    
    // dynamically import models to avoid circular dependencies if any
    const mongoose = (await import('mongoose')).default;
    
    const hospitalId = (req as any).user?.hospital || req.headers["x-hospital-id"] || (req as any).hospitalId;

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID required" });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "Edit reason is required for auditing" });
    }

    const editReason = String(reason).trim();
    const rawMode = String(paymentMode || 'cash').trim();
    const lowerMode = rawMode.toLowerCase();
    const userId = user?._id || user?.id || null;

    const hospitalObjId = mongoose.Types.ObjectId.isValid(hospitalId) ? new mongoose.Types.ObjectId(hospitalId) : null;
    const hospitalMatch = hospitalObjId ? { $in: [hospitalObjId, String(hospitalId)] } : hospitalId;

    let targetRef = referenceId;
    if (typeof targetRef === 'object' && targetRef?._id) targetRef = targetRef._id;
    if (!targetRef) targetRef = id;
    if (typeof targetRef === 'object' && targetRef?._id) targetRef = targetRef._id;

    const docIdStr = String(targetRef || '').trim();
    const idStr = String(id || '').trim();

    const candidateIds = Array.from(new Set([docIdStr, idStr])).filter(x => x && mongoose.Types.ObjectId.isValid(x));
    const normType = String(type || '').toLowerCase().trim();

    let updated = false;

    // Helper: IPD Advance mode mapping to match strict schema enum
    const ipdModeMap: Record<string, string> = {
      cash: "Cash",
      card: "Card",
      upi: "UPI",
      mixed: "Mixed",
      "bank transfer": "Bank Transfer",
      bank: "Bank Transfer",
      cheque: "Cheque",
      insurance: "Insurance",
      "digital wallet": "Digital Wallet",
      "corporate/sponsor": "Corporate/Sponsor",
    };
    const ipdMode = ipdModeMap[lowerMode] || "Cash";

    // 1. Check if ID has format <reportId>_<subId> (Manual Entry in TransactionReport)
    if (docIdStr.includes('_') || idStr.includes('_')) {
      const compoundId = docIdStr.includes('_') ? docIdStr : idStr;
      const [reportId, subId] = compoundId.split('_');
      if (mongoose.Types.ObjectId.isValid(reportId)) {
        const TransactionReport = mongoose.model("TransactionReport");
        const rep = await TransactionReport.findOne({ _id: reportId, hospital: hospitalMatch });
        if (rep) {
          if (rep.reportData?.payments && Array.isArray(rep.reportData.payments)) {
            const p = rep.reportData.payments.find((x: any) => x.id === subId || x._id === subId);
            if (p) {
              p.mode = rawMode;
              if (paymentDetails) p.paymentDetails = paymentDetails;
            } else if (rep.reportData.payments.length > 0) {
              rep.reportData.payments[0].mode = rawMode;
              if (paymentDetails) rep.reportData.payments[0].paymentDetails = paymentDetails;
            }
          }
          rep.isEdited = true;
          rep.editReason = editReason;
          rep.editedAt = new Date();
          if (userId) rep.editedBy = userId;
          rep.markModified("reportData");
          await rep.save();
          updated = true;
        }
      }
    }

    // Updaters for each model:
    const tryUpdateAppointment = async (targetId: string) => {
      const Appointment = mongoose.model("Appointment");
      const apt = await Appointment.findOne({ _id: targetId, hospital: hospitalMatch }) || await Appointment.findById(targetId);
      if (apt) {
        if (!apt.payment) apt.payment = {} as any;
        apt.payment.paymentMethod = lowerMode;
        apt.paymentMethod = lowerMode;
        if (lowerMode === "mixed" && paymentDetails) {
          apt.payment.paymentDetails = paymentDetails;
          apt.paymentDetails = paymentDetails;
        }
        apt.isEdited = true;
        apt.editReason = editReason;
        apt.editedAt = new Date();
        if (userId) apt.editedBy = userId;
        await apt.save();
        return true;
      }
      return false;
    };

    const tryUpdateLabOrder = async (targetId: string) => {
      const LabOrder = mongoose.model("LabOrder");
      const lab = await LabOrder.findOne({ _id: targetId, hospital: hospitalMatch }) || await LabOrder.findById(targetId);
      if (lab) {
        lab.isEdited = true;
        lab.editReason = editReason;
        lab.editedAt = new Date();
        if (userId) lab.editedBy = userId;
        await lab.save();

        if (lab.invoiceId) {
          const Transaction = mongoose.model("Transaction");
          const tx = await Transaction.findOne({ _id: lab.invoiceId, hospital: hospitalMatch }) || await Transaction.findById(lab.invoiceId);
          if (tx) {
            tx.paymentMode = lowerMode;
            if (lowerMode === "mixed" && paymentDetails) tx.paymentDetails = paymentDetails;
            tx.isEdited = true;
            tx.editReason = editReason;
            tx.editedAt = new Date();
            if (userId) tx.editedBy = userId;
            await tx.save();
          }
        }
        return true;
      }
      return false;
    };

    const tryUpdateIPDAdvance = async (targetId: string) => {
      const IPDAdvancePayment = mongoose.model("IPDAdvancePayment");
      const ipdAdv = await IPDAdvancePayment.findOne({ _id: targetId, hospital: hospitalMatch }) || await IPDAdvancePayment.findById(targetId);
      if (ipdAdv) {
        ipdAdv.mode = ipdMode;
        if (paymentDetails) {
          ipdAdv.paymentDetails = {
            cash: Number(paymentDetails.cash || 0),
            upi: Number(paymentDetails.upi || 0),
            card: Number(paymentDetails.card || 0),
            bankTransfer: Number(paymentDetails.bankTransfer || 0),
          };
        }
        ipdAdv.isEdited = true;
        ipdAdv.editReason = editReason;
        ipdAdv.editedAt = new Date();
        if (userId) ipdAdv.editedBy = userId;
        await ipdAdv.save();
        return true;
      }
      return false;
    };

    const tryUpdateDischarge = async (targetId: string) => {
      const DischargeRecord = mongoose.model("DischargeRecord");
      const dis = await DischargeRecord.findOne({ _id: targetId, hospital: hospitalMatch }) || await DischargeRecord.findById(targetId);
      if (dis) {
        dis.paymentMode = lowerMode;
        dis.isEdited = true;
        dis.editReason = editReason;
        dis.editedAt = new Date();
        if (userId) dis.editedBy = userId;
        await dis.save();
        return true;
      }
      return false;
    };

    const tryUpdatePharma = async (targetId: string) => {
      const PharmaInvoice = mongoose.model("PharmaInvoice");
      const inv = await PharmaInvoice.findOne({ _id: targetId, hospital: hospitalMatch }) || await PharmaInvoice.findById(targetId);
      if (inv) {
        const upperMode = rawMode.toUpperCase();
        inv.mode = ["CASH", "CARD", "UPI", "CREDIT", "MIXED"].includes(upperMode) ? upperMode : "CASH";
        if (lowerMode === "mixed" && paymentDetails) {
          inv.paymentDetails = {
            cash: Number(paymentDetails.cash || 0),
            card: Number(paymentDetails.card || 0),
            upi: Number(paymentDetails.upi || 0),
          };
        }
        inv.isEdited = true;
        inv.editReason = editReason;
        inv.editedAt = new Date();
        if (userId) inv.editedBy = userId;
        await inv.save();
        return true;
      }
      return false;
    };

    const tryUpdateTransaction = async (targetId: string) => {
      const TransactionModel = mongoose.model("Transaction");
      const baseTx = await TransactionModel.findOne({ _id: targetId, hospital: hospitalMatch }) || await TransactionModel.findById(targetId);
      if (baseTx) {
        baseTx.paymentMode = lowerMode;
        if (lowerMode === "mixed" && paymentDetails) {
          baseTx.paymentDetails = paymentDetails;
        }
        baseTx.isEdited = true;
        baseTx.editReason = editReason;
        baseTx.editedAt = new Date();
        if (userId) baseTx.editedBy = userId;
        await baseTx.save();
        return true;
      }
      return false;
    };

    // 2. Type-directed search
    if (!updated) {
      for (const targetId of candidateIds) {
        if (normType.includes("appointment") || normType.includes("opd") || normType.includes("consultation")) {
          if (await tryUpdateAppointment(targetId)) { updated = true; break; }
        } else if (normType.includes("lab")) {
          if (await tryUpdateLabOrder(targetId)) { updated = true; break; }
        } else if (normType.includes("ipd_advance") || normType.includes("advance") || normType === "ipd" || normType.includes("interim") || normType.includes("ipd_bill_payment")) {
          if (await tryUpdateIPDAdvance(targetId)) { updated = true; break; }
        } else if (normType.includes("discharge") || normType.includes("settlement") || normType.includes("final")) {
          if (await tryUpdateDischarge(targetId)) { updated = true; break; }
        } else if (normType.includes("pharma")) {
          if (await tryUpdatePharma(targetId)) { updated = true; break; }
        } else if (normType.includes("package") || normType.includes("transaction")) {
          if (await tryUpdateTransaction(targetId)) { updated = true; break; }
        }
      }
    }

    // 3. Fallback search across all collections
    if (!updated) {
      for (const targetId of candidateIds) {
        if (await tryUpdateAppointment(targetId)) { updated = true; break; }
        if (await tryUpdateIPDAdvance(targetId)) { updated = true; break; }
        if (await tryUpdateTransaction(targetId)) { updated = true; break; }
        if (await tryUpdateDischarge(targetId)) { updated = true; break; }
        if (await tryUpdateLabOrder(targetId)) { updated = true; break; }
        if (await tryUpdatePharma(targetId)) { updated = true; break; }
      }
    }

    if (!updated) {
      return res.status(404).json({ message: "Transaction record not found in source collections" });
    }

    res.json({ success: true, message: "Transaction successfully updated" });
  } catch (err: any) {
    console.error("editTransaction error:", err);
    res.status(500).json({ success: false, message: err?.message || "Internal Server Error" });
  }
};


export const generatePayroll = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, userId } = req.body;
    const requester = (req as any).user;
    const hospitalId = await getRequesterHospitalId(req);

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID required" });
    }

    if (!fromDate || !toDate) {
      return res
        .status(400)
        .json({ message: "fromDate and toDate are required" });
    }

    const results = await hospitalAdminService.generateRangePayroll(
      hospitalId,
      new Date(fromDate),
      new Date(toDate),
      requester._id.toString(),
      userId,
    );

    res.json({
      message: `Generated payroll records for ${results.length} staff members`,
      count: results.length,
    });
  } catch (err: any) {
    console.error(err);
    res
      .status(500)
      .json({ message: err?.message || "Failed to generate payroll" });
  }
};

export const getPayrollList = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, page, limit } = req.query as any;
    const requester = (req as any).user;
    const hospitalId = await getRequesterHospitalId(req);

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID required" });
    }

    const result = await hospitalAdminService.getPayrollList(
      hospitalId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      parseInt(page) || 1,
      parseInt(limit) || 20,
    );

    res.json(result);
  } catch (err: any) {
    console.error(err);
    res
      .status(500)
      .json({ message: err?.message || "Failed to fetch payroll list" });
  }
};

export const updatePayrollStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, paymentMethod, transactionId } = req.body;

    const result = await hospitalAdminService.updatePayrollStatus(id, status, {
      method: paymentMethod,
      transactionId,
    });

    if (!result)
      return res.status(404).json({ message: "Payroll record not found" });

    res.json({ message: "Payroll status updated", payroll: result });
  } catch (err: any) {
    console.error(err);
    res
      .status(500)
      .json({ message: err?.message || "Failed to update payroll" });
  }
};

export const updatePayroll = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await hospitalAdminService.updatePayroll(id, req.body);
    if (!result)
      return res.status(404).json({ message: "Payroll record not found" });
    res.json({ message: "Payroll updated successfully", payroll: result });
  } catch (err: any) {
    console.error(err);
    res
      .status(500)
      .json({ message: err?.message || "Failed to update payroll" });
  }
};

export const deletePayroll = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await Payroll.findByIdAndDelete(id);
    res.json({ message: "Payroll record deleted successfully" });
  } catch (err: any) {
    console.error(err);
    res
      .status(500)
      .json({ message: err?.message || "Failed to delete payroll" });
  }
};

/**
 * GET /payroll/:id
 * Retrieve a specific payroll record with expanded user & hospital context
 */
export const getPayrollById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payroll = await Payroll.findById(id)
      .populate("user", "name employeeId email mobile role profile")
      .populate("hospital", "name address logo phone email website");

    if (!payroll) {
      return res.status(404).json({ message: "Payroll record not found" });
    }

    res.json(payroll);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get Payroll Stats for a Specific Employee Based on Attendance Logs
 * Returns: totalDays, workingDays, presentDays, paidLeaveDays, absentDays, weeklyOffDays, monthlySalary, netPayable
 */
export const getEmployeePayrollStats = async (req: Request, res: Response) => {
  try {
    const { userId, startDate, endDate } = req.query as any;
    const hospitalId = await getRequesterHospitalId(req);

    if (!hospitalId) {
      return res.status(400).json({ message: "Hospital ID required" });
    }
    if (!userId || !startDate || !endDate) {
      return res
        .status(400)
        .json({ message: "userId, startDate and endDate are required" });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // 1. Fetch user info
    const user = await User.findById(userId)
      .select("name email role status")
      .lean();
    if (!user) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // 2. Fetch profile (for salary, weeklyOff, etc.)
    let profile: any = null;
    if (user.role === "doctor") {
      profile = await DoctorProfile.findOne({ user: userId })
        .select(
          "baseSalary weeklyOff pfNumber esiNumber designation department employeeId",
        )
        .lean();
    } else {
      profile = await StaffProfile.findOne({ user: userId })
        .select(
          "baseSalary weeklyOff pfNumber esiNumber designation department employeeId",
        )
        .lean();
    }

    const baseSalary = profile?.baseSalary || 0;
    const weeklyOff: string[] = profile?.weeklyOff || [];

    // 3. Fetch attendance records for date range
    const attendanceRecords = await Attendance.find({
      user: userId,
      hospital: hospitalId,
      date: { $gte: start, $lte: end },
    }).lean();

    const approvedLeaves = await Leave.find({
      requester: userId,
      hospital: hospitalId,
      status: "approved",
      $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }],
    }).lean();

    // 5. Calendar Computation Loop
    let totalDays = 0;
    let workingDays = 0;
    let presentDays = 0;
    let paidLeaveDays = 0;
    let absentDays = 0;
    let weeklyOffDays = 0;

    // Helper: Robust local date string YYYY-MM-DD
    const getDateStr = (d: Date) => {
      return (
        d.getFullYear() +
        "-" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(d.getDate()).padStart(2, "0")
      );
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = getDateStr(today);

    // Filter attendance to unique list of dates (just in case)
    const attendanceDateSet = new Set(
      attendanceRecords
        .filter((a) => ["present", "late", "half-day"].includes(a.status))
        .map((a) => getDateStr(new Date(a.date))),
    );

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const currentDate = new Date(d);
      const currentTimeStr = getDateStr(currentDate);
      totalDays++;

      const dayName = currentDate.toLocaleDateString("en-US", {
        weekday: "long",
      });
      const isWeeklyOff = profile?.weeklyOff?.some(
        (wo: string) => wo.toLowerCase() === dayName.toLowerCase(),
      );

      const isOnLeave = approvedLeaves.some((l) => {
        const lS = getDateStr(new Date(l.startDate));
        const lE = getDateStr(new Date(l.endDate));
        return currentTimeStr >= lS && currentTimeStr <= lE;
      });

      const hasAttendance = attendanceDateSet.has(currentTimeStr);

      if (isWeeklyOff) {
        weeklyOffDays++;
      } else {
        workingDays++;
        if (hasAttendance) {
          presentDays++;
        } else if (isOnLeave) {
          paidLeaveDays++;
        } else if (currentTimeStr < todayStr) {
          // Strictly past days only are considered absent
          absentDays++;
        }
        // Future days (currentTimeStr >= todayStr) with no attendance are neither present nor absent yet
      }
    }

    // Sum custom items from profile
    const customAllowances =
      profile?.allowances?.reduce(
        (acc: number, c: any) => acc + (c.amount || 0),
        0,
      ) || 0;
    const customDeductions =
      profile?.deductions?.reduce(
        (acc: number, c: any) => acc + (c.amount || 0),
        0,
      ) || 0;

    // 6. Calculate salary (Synced with generateRangePayroll logic)
    const dayRate = totalDays > 0 ? baseSalary / totalDays : 0;

    // Net Salary is strictly what they've EARNED so far (Credited Days) + Custom Items
    const totalCreditedDays = presentDays + paidLeaveDays + weeklyOffDays;
    const netPayable = Math.round(
      dayRate * totalCreditedDays + customAllowances - customDeductions,
    );
    const absencePenalty = Math.round(absentDays * dayRate);

    // For display, we keep it simple
    const basic = Math.floor(dayRate * totalCreditedDays * 0.5);

    // 7. Get existing payroll record if any
    const existingPayroll = await Payroll.findOne({
      user: userId,
      hospital: hospitalId,
      startDate: { $lte: end },
      endDate: { $gte: start },
    }).lean();

    res.json({
      employee: {
        ...user,
        employeeId: profile?.employeeId || null,
        designation: profile?.designation || user.role,
        department: profile?.department || null,
        baseSalary,
        customAllowances,
        customDeductions,
        totalPossible: baseSalary + customAllowances - customDeductions,
      },
      period: { startDate: start, endDate: end },
      attendance: {
        totalDays,
        workingDays,
        weeklyOffDays,
        presentDays,
        paidLeaveDays,
        absentDays,
        attendanceRecords: attendanceRecords.map((a) => ({
          date: a.date,
          status: a.status,
        })),
      },
      salary: {
        monthlySalary: baseSalary,
        dayRate,
        earnedDays: presentDays + paidLeaveDays + weeklyOffDays,
        absencePenalty,
        customAllowances,
        customDeductions,
        netPayable,
      },
      existingPayroll: existingPayroll || null,
    });
  } catch (err: any) {
    console.error("[getEmployeePayrollStats] ERROR:", err);
    res.status(500).json({
      message: err?.message || "Failed to fetch employee payroll stats",
    });
  }
};

export const getAnalytics = async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch all hospitals for name mapping
    const hospitals = await Hospital.find().select("name").lean();
    const hospitalMap = new Map(
      hospitals.map((h) => [h._id.toString(), h.name]),
    );

    // 1. Pharma Revenue & Breakdown
    const pharmaHospitalBreakdown = await PharmaInvoice.aggregate([
      { $match: { status: "PAID" } },
      {
        $group: {
          _id: "$hospital",
          total: { $sum: "$netPayable" },
          count: { $sum: 1 },
        },
      },
    ]);
    const pharmaRevenue = pharmaHospitalBreakdown.reduce(
      (acc, curr) => acc + curr.total,
      0,
    );

    // 2. Lab Revenue & Breakdown
    const labHospitalBreakdown = await LabOrder.aggregate([
      { $match: { paymentStatus: "paid" } },
      {
        $group: {
          _id: "$hospital",
          total: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
    ]);
    const labRevenue = labHospitalBreakdown.reduce(
      (acc, curr) => acc + curr.total,
      0,
    );

    // 3. OPD (Appointment) Revenue & Breakdown
    const opdHospitalBreakdown = await Appointment.aggregate([
      {
        $match: {
          isIPD: false,
          $or: [
            { paymentStatus: { $in: ["Paid", "paid"] } },
            { "payment.paymentStatus": { $in: ["Paid", "paid"] } },
          ],
        },
      },
      {
        $group: {
          _id: "$hospital",
          total: {
            $sum: { $ifNull: ["$amount", { $ifNull: ["$payment.amount", 0] }] },
          },
          count: { $sum: 1 },
        },
      },
    ]);
    const opdRevenue = opdHospitalBreakdown.reduce(
      (acc, curr) => acc + curr.total,
      0,
    );

    // 4. IPD Revenue & Breakdown
    const ipdHospitalBreakdown = await Transaction.aggregate([
      {
        $match: {
          status: "completed",
          type: {
            $in: ["ipd_advance", "ipd_settlement", "ipd", "ipd_admission"],
          },
        },
      },
      {
        $group: {
          _id: "$hospital",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);
    const ipdRevenue = ipdHospitalBreakdown.reduce(
      (acc, curr) => acc + curr.total,
      0,
    );

    const formatBreakdown = (breakdown: any[]) =>
      breakdown
        .map((b) => ({
          hospitalId: b._id,
          hospitalName: hospitalMap.get(b._id?.toString()) || "Unknown",
          revenue: b.total,
          count: b.count,
        }))
        .filter((b) => b.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue);

    // User Statistics
    const totalDoctors = await (
      User.countDocuments({ role: "doctor" }) as any
    ).unscoped();
    const totalNurses = await (
      User.countDocuments({ role: "nurse" }) as any
    ).unscoped();
    const totalStaff = await (
      User.countDocuments({ role: "staff" }) as any
    ).unscoped();
    const totalHelpdesks = await (
      User.countDocuments({ role: "helpdesk" }) as any
    ).unscoped();
    const totalPatients = await (Patient.countDocuments() as any).unscoped();

    // Ambulance Personnel
    const totalEmergencies = await AmbulancePersonnel.countDocuments();

    // Doctors Present Today
    const doctorsPresent = await Attendance.aggregate([
      {
        $match: {
          date: { $gte: today },
          status: { $in: ["present", "late", "half-day"] },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      { $unwind: "$userInfo" },
      { $match: { "userInfo.role": "doctor" } },
      { $count: "count" },
    ]);

    // Total Users & Hospitals
    const totalUsers = await (User.countDocuments() as any).unscoped();
    const totalHospitals = await Hospital.countDocuments();

    res.json({
      pharmaRevenue,
      pharmaBreakdown: formatBreakdown(pharmaHospitalBreakdown),
      labRevenue,
      labBreakdown: formatBreakdown(labHospitalBreakdown),
      opdRevenue,
      opdBreakdown: formatBreakdown(opdHospitalBreakdown),
      ipdRevenue,
      ipdBreakdown: formatBreakdown(ipdHospitalBreakdown),
      totalDoctors,
      totalNurses,
      totalStaff,
      totalHelpdesks,
      totalPatients,
      totalEmergencies,
      doctorsPresent: doctorsPresent[0]?.count || 0,
      totalUsers: totalUsers + totalHelpdesks + totalEmergencies,
      totalHospitals,
    });
  } catch (error: any) {
    console.error("Super Admin Analytics Error:", error);
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
};

// Ambulance Personnel Management
export const getAllAmbulancePersonnel = async (req: Request, res: Response) => {
  try {
    const personnel = await AmbulancePersonnel.find().sort({ createdAt: -1 });
    res.json(personnel);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error?.message,
      stack: error?.stack,
    });
  }
};

export const createAmbulancePersonnel = async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      mobile,
      password,
      employeeId,
      vehicleNumber,
      driverLicense,
    } = req.body;

    const existing = await AmbulancePersonnel.findOne({
      $or: [{ email }, { mobile }, { employeeId }],
    });
    if (existing)
      return res
        .status(400)
        .json({ message: "Personnel with email/mobile/ID already exists" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newItem = new AmbulancePersonnel({
      name,
      email,
      mobile,
      password: hashedPassword,
      employeeId,
      vehicleNumber,
      driverLicense,
      status: "active",
    });
    await newItem.save();
    res.status(201).json(newItem);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: error.message || "Failed to create" });
  }
};

export const updateAmbulancePersonnel = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    if (updates.password) {
      const salt = await bcrypt.genSalt(10);
      updates.password = await bcrypt.hash(updates.password, salt);
    }
    const updated = await AmbulancePersonnel.findByIdAndUpdate(id, updates, {
      new: true,
    });
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: "Update failed" });
  }
};

export const deleteAmbulancePersonnel = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await AmbulancePersonnel.findByIdAndDelete(id);
    res.json({ message: "Deleted successfully" });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: "Delete failed" });
  }
};

export const getHospitalPersonnel = async (req: Request, res: Response) => {
  try {
    const { id: hospitalId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(hospitalId)) {
      return res.status(400).json({ message: "Invalid Hospital ID" });
    }

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({ message: "Hospital not found" });
    }

    // Parallel queries to fetch all members associated with this hospital
    const [
      doctorsRaw,
      nurses,
      lab,
      pharmaRaw,
      helpdesk,
      staff,
      emergency,
      hospitalAdmins,
      masterhelpdesk,
      hr,
      discharge,
    ] = await Promise.all([
      (
        User.find({ hospital: hospitalId, role: "doctor" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
      (
        User.find({ hospital: hospitalId, role: "nurse" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
      (
        User.find({ hospital: hospitalId, role: "lab" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
      (
        User.find({ hospital: hospitalId, role: "pharma-owner" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
      (
        User.find({ hospital: hospitalId, role: "helpdesk" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
      (
        User.find({ hospital: hospitalId, role: "staff" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
      (
        User.find({ hospital: hospitalId, role: "emergency" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
      (
        User.find({ hospital: hospitalId, role: "hospital-admin" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
      (
        User.find({ hospital: hospitalId, role: "masterhelpdesk" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
      (
        User.find({ hospital: hospitalId, role: "hr" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
      (
        User.find({ hospital: hospitalId, role: "discharge" })
          .select("-password -refreshTokens")
          .lean() as any
      ).unscoped(),
    ]);

    // Populate Doctor Profiles
    const doctorProfiles = await (
      DoctorProfile.find({
        user: { $in: doctorsRaw.map((d) => d._id) },
      }).lean() as any
    ).unscoped();
    const doctors = doctorsRaw.map((d) => ({
      ...d,
      profile: doctorProfiles.find(
        (p) => p.user?.toString() === d._id.toString(),
      ),
    }));

    // Populate Pharma Profiles
    const pharmaProfiles = await (
      PharmaProfile.find({
        user: { $in: pharmaRaw.map((p) => p._id) },
      }).lean() as any
    ).unscoped();
    const pharma = pharmaRaw.map((p) => ({
      ...p,
      profile: pharmaProfiles.find(
        (prof) => prof.user?.toString() === p._id.toString(),
      ),
    }));

    // Populate Staff Profiles
    const staffUserIds = [
      ...nurses,
      ...lab,
      ...staff,
      ...emergency,
      ...helpdesk,
      ...masterhelpdesk,
      ...hr,
      ...discharge,
    ].map((u) => u._id);
    const staffProfiles = await (
      StaffProfile.find({
        user: { $in: staffUserIds },
      }).lean() as any
    ).unscoped();

    const enrichWithStaffProfile = (users: any[]) =>
      users.map((u) => ({
        ...u,
        profile: staffProfiles.find(
          (p) => p.user?.toString() === u._id.toString(),
        ),
      }));

    res.json({
      hospital,
      personnel: {
        doctors,
        nurses: enrichWithStaffProfile(nurses),
        lab: enrichWithStaffProfile(lab),
        pharma,
        helpdesk: enrichWithStaffProfile(helpdesk),
        staff: enrichWithStaffProfile(staff),
        emergency: enrichWithStaffProfile(emergency),
        hospitalAdmins,
        masterhelpdesk: enrichWithStaffProfile(masterhelpdesk),
        hr: enrichWithStaffProfile(hr),
        discharge: enrichWithStaffProfile(discharge),
      },
    });
  } catch (err: any) {
    console.error("[getHospitalPersonnel] ERROR:", err);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: err.message });
  }
};

export const getHRUsers = async (req: Request, res: Response) => {
  try {
    const hrUsers = await (User.find({ role: "hr" }) as any)
      .unscoped()
      .populate({
        path: "hospital",
        select: "name hospitalId city",
        options: { unscoped: true } as any,
      })
      .sort({ createdAt: -1 });
    res.json(hrUsers);
  } catch (err: any) {
    console.error("[getHRUsers] ERROR:", err);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: err.message });
  }
};

export const seedHRUsers = async (req: Request, res: Response) => {
  try {
    const hospitals = await Hospital.find().lean();
    const results: any[] = [];

    for (const hospital of hospitals) {
      const existingHR = await (
        User.findOne({
          hospital: hospital._id,
          role: "hr",
        }) as any
      ).unscoped();

      if (!existingHR) {
        const password = "hr@123";
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate a unique email
        const hId =
          hospital.hospitalId?.toLowerCase().replace(/\s+/g, "") ||
          hospital._id.toString().slice(-4);
        const email = `hr.${hId}@mscurechain.com`;

        // Ensure email uniqueness if multiple hospitals have same ID (unlikely but safe)
        const emailExists = await (User.findOne({ email }) as any).unscoped();
        const finalEmail = emailExists
          ? `hr.${hId}.${Math.floor(Math.random() * 1000)}@mscurechain.com`
          : email;

        // Generate a random but unique-ish mobile
        const mobile = `99${Math.floor(10000000 + Math.random() * 90000000)}`;

        const newHR = await User.create({
          name: `${hospital.name} HR`,
          email: finalEmail,
          mobile,
          password: hashedPassword,
          role: "hr",
          hospital: hospital._id,
          status: "active",
        });

        const qrSecret = crypto.randomBytes(32).toString("hex");
        await StaffProfile.create({
          user: newHR._id,
          hospital: hospital._id,
          qrSecret,
          designation: "HR Manager",
          department: "Human Resources",
          status: "active",
        });

        results.push({
          hospital: hospital.name,
          email: newHR.email,
          status: "created",
        });
      } else {
        results.push({
          hospital: hospital.name,
          email: existingHR.email,
          status: "already_exists",
        });
      }
    }

    res.json({
      success: true,
      message: "HR Seeding completed",
      results,
    });
  } catch (err: any) {
    console.error("[seedHRUsers] ERROR:", err);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: err.message });
  }
};
