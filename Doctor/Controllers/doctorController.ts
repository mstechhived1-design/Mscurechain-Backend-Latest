import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import { tenantLocalStorage } from "../../middleware/tenantPlugin.js";
import DoctorProfile from "../Models/DoctorProfile.js";
import User from "../../Auth/Models/User.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Patient from "../../Patient/Models/Patient.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import Report from "../../Report/Models/Report.js";
import Leave from "../../Leave/Models/Leave.js";
import MasterDoctorLeave from "../../MasterHelpdesk/Models/MasterDoctorLeave.js";
import cloudinary from "../../config/cloudinary.js";
import { DoctorRequest, IDoctorProfile } from "../types/index.js";
import { IUser } from "../../Auth/types/index.js";
import doctorService from "../../services/doctor.service.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import Bed from "../../IPD/Models/Bed.js";
import VitalsRecord from "../../IPD/Models/VitalsRecord.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import StaffProfile from "../../Staff/Models/StaffProfile.js";
import { processSingleProfileExpiry } from "../../services/reminderService.js";
import redisService from "../../config/redis.js";
import { uploadToCloudinary } from "../../utils/uploadToCloudinary.js";
import { decryptObject } from "../../utils/crypto.js";
import LabOrder from "../../Lab/Models/LabOrder.js";

export const getDoctorProfile = async (req: Request, res: Response) => {
  (req as any).markStage?.("getProfile-start");
  const docReq = req as unknown as DoctorRequest;
  try {
    if (!docReq.user || !docReq.user._id)
      return res.status(401).json({ message: "Unauthorized" });

    // 🚀 CACHE: Check Redis first (5 minute cache for profile)
    const cacheKey = `doctor:profile:${docReq.user._id}`;
    const cached = await redisService.get(cacheKey);
    if (cached) {
      console.log(`✅ [Cache HIT] Doctor profile for ${docReq.user._id}`);
      return res.json(cached);
    }

    (req as any).markStage?.("getProfile-find-start");
    let profile = await (
      DoctorProfile.findOne({ user: docReq.user._id }) as any
    )
      .unscoped()
      .populate({
        path: "user",
        select: "name email mobile doctorId gender dateOfBirth",
        options: { unscoped: true } as any,
      })
      .populate({
        path: "hospital",
        select: "name address phone email hospitalId",
        options: { unscoped: true } as any,
      });
    (req as any).markStage?.("getProfile-find-end");

    if (!profile) {
      // Self-healing: If user is a doctor but has no profile, create it now
      const user = await (User.findById(docReq.user._id) as any).unscoped();
      if (user && user.role === "doctor") {
        profile = await DoctorProfile.create({
          user: user._id,
          hospital: user.hospital || null,
        });
        // Re-populate for response
        profile = await (
          await profile.populate({
            path: "user",
            select: "name email mobile doctorId gender dateOfBirth",
          })
        ).populate({
          path: "hospital",
          select: "name address phone email hospitalId",
        });
      } else {
        return res.status(404).json({ message: "Doctor profile not found" });
      }
    }

    // 🚀 CACHE: Store for 5 minutes
    await redisService.set(cacheKey, profile, 300);

    const profileObj = profile.toObject() as any;
    const decryptedProfile = decryptObject(profileObj);
    res.json(decryptedProfile);
  } catch (err) {
    console.error("getDoctorProfile error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getDoctorDashboard = async (req: Request, res: Response) => {
  (req as any).markStage?.("dashboard-start");
  const docReq = req as unknown as DoctorRequest;
  try {
    if (!docReq.user || !docReq.user._id)
      return res.status(401).json({ message: "Unauthorized" });

    // 🚀 CACHE: Check Redis first (5 second cache - allows real-time updates)
    const cacheKey = `doctor:dashboard:${docReq.user._id}`;
    // ✅ FIX: Clear stale cache to ensure fresh appointment data is returned
    await redisService.del(cacheKey);
    // const cached = await redisService.get(cacheKey);
    // if (cached) {
    //   console.log(`✅ [Cache HIT] Doctor dashboard for ${docReq.user._id}`);
    //   return res.json(cached);
    // }
    (req as any).markStage?.("dashboard-cache-miss");

    let doctorProfile = await (
      DoctorProfile.findOne({ user: docReq.user._id }) as any
    )
      .unscoped()
      .select("_id hospital")
      .lean();

    if (!doctorProfile) {
      const user = await (User.findById(docReq.user._id) as any).unscoped();
      if (user && user.role === "doctor") {
        const newProfile = await DoctorProfile.create({
          user: user._id,
          hospital: user.hospital || null,
        });
        doctorProfile = newProfile.toObject();
      } else {
        return res.status(404).json({ message: "Doctor profile not found" });
      }
    }

    // Use high-performance service for stats
    const stats = await doctorService.getDashboardStats(
      doctorProfile._id.toString(),
    );

    // For appointments and recent patients, we still fetch them here for full detail,
    // but the core metrics are now cached and super fast.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todayAppointments, recentAppointments] = await Promise.all([
      (
        Appointment.find({
          doctor: doctorProfile._id,
          // ✅ CRITICAL FIX: Include ALL active/booked statuses.
          // "Booked" is the default status when helpdesk registers a patient.
          // Scoped to today's date OR any pending/active status (cross-day queue).
          $or: [
            { date: { $gte: today, $lt: tomorrow } },
            {
              status: {
                $in: [
                  "pending",
                  "confirmed",
                  "in-progress",
                  "Booked",
                  "waiting",
                  "scheduled",
                ],
              },
            },
          ],
          status: { $ne: "cancelled" },
          isPaused: { $ne: true },
        }) as any
      )
        .unscoped()
        // ✅ FIX: Explicitly specify model to avoid resolution issues
        .populate({
          path: "patient",
          select: "name mobile email",
          model: "Patient",
        })
        .populate("hospital", "name address hospitalId")
        .sort({ date: 1, createdAt: 1 })
        .select(
          "patient hospital date appointmentTime startTime type status reason createdAt mrn",
        )
        .limit(300) // ✅ FIX: Increased limit from 50 to 300
        .lean(),
      (Appointment.find({ doctor: doctorProfile._id }) as any)
        .unscoped()
        .populate({
          path: "patient",
          select: "name mobile email _id mrn",
          model: "Patient",
        })
        .select("patient date mrn") // Minimal fields for recent patients
        .sort({ date: -1 })
        .limit(15)
        .lean(),
    ]);

    const recentPatientsMap = new Map();
    recentAppointments.forEach((apt: any) => {
      if (apt.patient && !recentPatientsMap.has(apt.patient._id.toString())) {
        recentPatientsMap.set(apt.patient._id.toString(), {
          id: apt.patient._id,
          name: apt.patient.name,
          mobile: apt.patient.mobile,
          email: apt.patient.email,
          mrn: apt.mrn || apt.patient.mrn, // Prefer appointment MRN, fallback to patient model
          lastVisit: apt.date,
        });
      }
    });
    const recentPatients = Array.from(recentPatientsMap.values()).slice(0, 5);

    const responseData = {
      stats: {
        totalPatients: stats.totalPatients,
        appointmentsToday: stats.appointmentsToday,
        totalPendingQueue: stats.totalPendingQueue,
        pendingReports: stats.pendingReports,
        activeInpatients: stats.activeInpatients,
        criticalAlerts: stats.criticalAlerts,
        warningAlerts: stats.warningAlerts,
        consultationsValue: stats.consultationsValue,
      },
      appointments: await (async () => {
        // Collect patient IDs to fetch their MRNs from profile in one go
        const patientIdsWithNoMrn = todayAppointments
          .filter((apt: any) => !apt.mrn && apt.patient?._id)
          .map((apt: any) => apt.patient._id);

        let profileMrnMap = new Map();
        if (patientIdsWithNoMrn.length > 0) {
          const profiles = await (PatientProfile.find({ 
            user: { $in: patientIdsWithNoMrn },
            hospital: doctorProfile.hospital 
          }) as any).unscoped().select("user mrn").lean();
          
          profiles.forEach((p: any) => profileMrnMap.set(p.user.toString(), p.mrn));
        }

        return todayAppointments.map((apt: any) => ({
          id: apt._id,
          patientName: apt.patient?.name || "Unknown",
          patientId: apt.patient?._id || "N/A",
          mrn: apt.mrn || profileMrnMap.get(apt.patient?._id?.toString()) || "N/A",
          time: apt.appointmentTime || apt.startTime || "N/A",
          type: apt.type || "Consultation",
          status: apt.status,
          hospital: apt.hospital?.name || "Unknown",
          createdAt: apt.createdAt,
          date: apt.date,
        }));
      })(),
      recentPatients,
    };

    // 🚀 CACHE: Store for 5 seconds (allows real-time WebSocket updates)
    await redisService.set(cacheKey, responseData, 5);

    res.json(responseData);
  } catch (err: any) {
    console.error("getDoctorDashboard error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const updateDoctorProfile = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  const userHospital = docReq.user!.hospital;
  const hId = userHospital
    ? typeof userHospital === "string"
      ? new mongoose.Types.ObjectId(userHospital)
      : (userHospital as mongoose.Types.ObjectId)
    : null;

  // Restore tenant context dropped by multer
  return tenantLocalStorage.run(
    {
      tenantId: hId,
      userId: docReq.user!._id
        ? new mongoose.Types.ObjectId(docReq.user!._id.toString())
        : null,
      role: docReq.user!.role,
      isSuperAdmin: (docReq.user!.role as string) === "super-admin",
    },
    async () => {
      try {
        let profile = await (
          DoctorProfile.findOne({ user: docReq.user!._id }) as any
        ).unscoped();

        // Handle File Uploads via Multer (upload.any())
        const files = req.files as Express.Multer.File[];
        if (files && files.length > 0) {
          const uploadPromises = files.map((file) => {
            return new Promise<any>((resolve, reject) => {
              const isPdf = file.mimetype === "application/pdf";
              const resourceType = isPdf ? "raw" : "image";
              const uploadStream = cloudinary.uploader.upload_stream(
                {
                  folder: "doctor_docs",
                  resource_type: resourceType,
                  access_mode: "public",
                },
                (error, result) => {
                  if (error) return reject(error);
                  resolve({
                    fieldname: file.fieldname,
                    url: result?.secure_url,
                  });
                },
              );
              uploadStream.end(file.buffer);
            });
          });

          const results = await Promise.all(uploadPromises);
          results.forEach((res) => {
            if (res.fieldname === "degreeCertificate")
              req.body.degreeCertificate = res.url;
            if (res.fieldname === "registrationCertificate")
              req.body.registrationCertificate = res.url;
            if (res.fieldname === "doctorateCertificate")
              req.body.doctorateCertificate = res.url;
            if (res.fieldname === "internshipCertificate")
              req.body.internshipCertificate = res.url;
            if (res.fieldname === "profilePic") req.body.profilePic = res.url; // Support profile pic too
            if (res.fieldname === "signature") req.body.signature = res.url;
          });
        }

        // UPSERT: Create profile if it doesn't exist
        if (!profile) {
          profile = new DoctorProfile({
            user: docReq.user!._id,
            hospital: req.body.hospital || hId || null,
          });
        } else {
          // ✅ AUTO-SYNC: If the profile's hospital doesn't match the user's current hospital (hId),
          // update it to match. This prevents "Security Violation" errors when a doctor 
          // updates their profile while browsing a different tenant, ensuring they can 
          // always manage their own global-ish record.
          if (hId && (!profile.hospital || profile.hospital.toString() !== hId.toString())) {
            profile.hospital = hId;
          }
        }

        // 1. Update Generic Profile Fields
        if (req.body.bio) profile.bio = req.body.bio;
        if (req.body.specialties) {
          try {
            profile.specialties =
              typeof req.body.specialties === "string"
                ? JSON.parse(req.body.specialties)
                : req.body.specialties;
          } catch {
            profile.specialties = req.body.specialties;
          }
        }
        if (req.body.qualifications) {
          try {
            profile.qualifications =
              typeof req.body.qualifications === "string"
                ? JSON.parse(req.body.qualifications)
                : req.body.qualifications;
          } catch {
            profile.qualifications = req.body.qualifications;
          }
        }
        if (req.body.degreeCertificate)
          profile.degreeCertificate = Array.isArray(req.body.degreeCertificate)
            ? req.body.degreeCertificate[0]
            : req.body.degreeCertificate;
        if (req.body.doctorateCertificate)
          profile.doctorateCertificate = Array.isArray(
            req.body.doctorateCertificate,
          )
            ? req.body.doctorateCertificate[0]
            : req.body.doctorateCertificate;
        if (req.body.internshipCertificate)
          profile.internshipCertificate = Array.isArray(
            req.body.internshipCertificate,
          )
            ? req.body.internshipCertificate[0]
            : req.body.internshipCertificate;
        if (req.body.registrationCertificate)
          profile.registrationCertificate = Array.isArray(
            req.body.registrationCertificate,
          )
            ? req.body.registrationCertificate[0]
            : req.body.registrationCertificate;

        if (req.body.profilePic) profile.profilePic = req.body.profilePic;
        if (req.body.signature) profile.signature = req.body.signature;

        // Handle Quick Notes (sanitized)
        if (req.body.quickNotes) {
          profile.quickNotes = req.body.quickNotes.filter(
            (n: any) => n.text && n.text.trim() !== "",
          );
        }

        // 2. Update Clinic/Hospital-Specific Fields
        if (req.body.consultationFee)
          profile.consultationFee = req.body.consultationFee;
        if (req.body.consultationDuration)
          profile.consultationDuration = req.body.consultationDuration;
        if (req.body.maxAppointmentsPerDay)
          profile.maxAppointmentsPerDay = req.body.maxAppointmentsPerDay;
        if (req.body.availability) profile.availability = req.body.availability;
        if (req.body.hospital) profile.hospital = req.body.hospital;

        // 3. Update Bank & Payroll Details (Mandatory for payslips)
        if (req.body.baseSalary !== undefined)
          profile.baseSalary = req.body.baseSalary;
        if (req.body.panNumber) profile.panNumber = req.body.panNumber;
        if (req.body.aadharNumber) profile.aadharNumber = req.body.aadharNumber;
        if (req.body.pfNumber) profile.pfNumber = req.body.pfNumber;
        if (req.body.esiNumber) profile.esiNumber = req.body.esiNumber;
        if (req.body.uanNumber) profile.uanNumber = req.body.uanNumber;
        if (req.body.languages) {
          try {
            profile.languages =
              typeof req.body.languages === "string"
                ? JSON.parse(req.body.languages)
                : req.body.languages;
          } catch {
            profile.languages = req.body.languages;
          }
        }
        if (req.body.awards) {
          try {
            profile.awards =
              typeof req.body.awards === "string"
                ? JSON.parse(req.body.awards)
                : req.body.awards;
          } catch {
            profile.awards = req.body.awards;
          }
        }
        if (req.body.bankDetails) {
          try {
            profile.bankDetails =
              typeof req.body.bankDetails === "string"
                ? JSON.parse(req.body.bankDetails)
                : req.body.bankDetails;
          } catch {
            profile.bankDetails = req.body.bankDetails;
          }
        }

        // Registration Details
        if (req.body.medicalRegistrationNumber)
          profile.medicalRegistrationNumber =
            req.body.medicalRegistrationNumber;
        if (req.body.registrationCouncil)
          profile.registrationCouncil = req.body.registrationCouncil;
        if (req.body.registrationYear)
          profile.registrationYear = req.body.registrationYear;
        if (req.body.registrationYear)
          profile.registrationYear = req.body.registrationYear;
        if (req.body.registrationCertificate)
          profile.registrationCertificate = req.body.registrationCertificate;
        // ✅ RE-ARM: Reset alert flags if the license expiry date has changed
        if (req.body.registrationExpiryDate) {
          profile.registrationExpiryDate = req.body.registrationExpiryDate;
          profile.expiryAlertsSent = {
            thirtyDay: false,
            sevenDay: false,
            oneDay: false,
            expired: false,
          };
        }

        // Department & Employment
        if (req.body.department) profile.department = req.body.department;
        if (req.body.designation) profile.designation = req.body.designation;
        if (req.body.employeeId) profile.employeeId = req.body.employeeId;
        if (req.body.room) profile.room = req.body.room;
        if (req.body.consultationDuration)
          profile.consultationDuration = req.body.consultationDuration;
        if (req.body.maxAppointmentsPerDay)
          profile.maxAppointmentsPerDay = req.body.maxAppointmentsPerDay;

        // Languages & Awards parsed above

        // 4. Save Changes
        // 4. Save Changes
        await profile.save();

        // ✅ IMMEDIATE TRIGGER: Check for expiry alerts instantly after save
        if (req.body.registrationExpiryDate) {
          await processSingleProfileExpiry(profile, "doctor");
        }

        // 4. Update User Model (Avatar, Image, Name, Mobile, Email)
        const userUpdates: any = {};
        if (req.body.profilePic) {
          userUpdates.avatar = req.body.profilePic;
          userUpdates.image = req.body.profilePic; // Ensure consistency for Navbar/Profiles
        }
        if (req.body.name) {
          let cleaned = req.body.name.trim();
          cleaned = cleaned.replace(/\s*\.+\s*/g, " ").replace(/\s+/g, " ").trim();
          while (/^(dr|dr\.|dr\s+|dr\.\s+)/i.test(cleaned)) {
            cleaned = cleaned.replace(/^(dr|dr\.|dr\s+|dr\.\s+)/i, "").trim();
          }
          userUpdates.name = cleaned ? `Dr. ${cleaned}` : "Doctor";
        }
        if (req.body.mobile) userUpdates.mobile = req.body.mobile;
        if (req.body.email) userUpdates.email = req.body.email;
        if (req.body.gender) userUpdates.gender = req.body.gender;
        if (req.body.dateOfBirth)
          userUpdates.dateOfBirth = req.body.dateOfBirth;

        if (Object.keys(userUpdates).length > 0) {
          await (
            User.findByIdAndUpdate(docReq.user!._id, userUpdates) as any
          ).unscoped();
        }

        // ✅ CACHE INVALIDATION: Force refresh for both Doctor Profile and Global Navbar
        const userId = docReq.user!._id.toString();
        const profileCacheKey = `doctor:profile:${userId}`;
        const authCacheKey = `auth:user:v2:${userId}`;
        
        await Promise.all([
          redisService.del(profileCacheKey),
          redisService.del(authCacheKey)
        ]);
        
        console.log(`[UpdateProfile] Cache invalidated for Doctor: ${userId}`);

        // 5. Return Updated Profile
        const updatedProfile = await (
          DoctorProfile.findById(profile._id) as any
        )
          .unscoped()
          .populate({
            path: "user",
            select: "name email role doctorId",
            options: { unscoped: true } as any,
          })
          .populate({ path: "hospital", select: "name address hospitalId" });

        const profileObj = updatedProfile.toObject() as any;
        res.json(decryptObject(profileObj));
      } catch (err: any) {
        if (err.code === 11000) {
          if (err.keyPattern && err.keyPattern.mobile) {
            return res.status(400).json({
              message:
                "This phone number is already registered with another user. Please select another phone number.",
            });
          }
          return res
            .status(400)
            .json({ message: "Duplicate field value entered" });
        }
        console.error("updateDoctorProfile error:", err);
        res.status(500).json({ message: err.message || "Server error" });
      }
    },
  ); // End tenantLocalStorage.run
};

export const searchDoctors = async (req: Request, res: Response) => {
  try {
    const { speciality, hospitalId } = req.query;
    const filter: any = {};

    // Filter by speciality if provided
    if (speciality) filter.specialties = speciality;

    // Filter by hospital — used by QR code scan flow: mscurechain://book?hospitalId=<id>
    if (hospitalId && mongoose.Types.ObjectId.isValid(hospitalId as string)) {
      filter.hospital = new mongoose.Types.ObjectId(hospitalId as string);
    }

    const docs = await (DoctorProfile.find(filter) as any)
      .unscoped()
      .select("specialties hospital consultationFee experienceStart consultationDuration isOnline")
      .populate({
        path: "user",
        select: "name email mobile doctorId",
        options: { unscoped: true } as any,
      })
      .populate({ path: "hospital", select: "name address hospitalId" })
      .lean();

    // Filter out doctors whose user record is missing/null
    const validDocs = docs.filter((d: any) => d.user !== null);

    res.json(validDocs);
  } catch (err) {
    console.error("searchDoctors error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getDoctorById = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    let userId = docReq.params.id;
    if (userId === "me") {
      if (!docReq.user || !docReq.user._id)
        return res.status(401).json({ message: "Unauthorized" });
      userId = docReq.user._id.toString();
    }

    let profile;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      // Try to find by DoctorProfile ID first
      profile = await (DoctorProfile.findById(userId) as any)
        .unscoped()
        .populate({
          path: "user",
          select: "name email mobile doctorId gender dateOfBirth status",
          options: { unscoped: true } as any,
        })
        .populate({ path: "hospital", select: "name address hospitalId" });

      // If not found, try as User ID
      if (!profile) {
        profile = await (DoctorProfile.findOne({ user: userId }) as any)
          .unscoped()
          .populate({
            path: "user",
            select: "name email mobile doctorId gender dateOfBirth status",
            options: { unscoped: true } as any,
          })
          .populate({ path: "hospital", select: "name address hospitalId" });
      }
    } else {
      const user = await (
        User.findOne({ doctorId: userId, role: "doctor" }) as any
      ).unscoped();
      if (!user) return res.status(404).json({ message: "Doctor not found" });
      profile = await (DoctorProfile.findOne({ user: user._id }) as any)
        .unscoped()
        .populate({
          path: "user",
          select: "name email mobile doctorId gender dateOfBirth status",
          options: { unscoped: true } as any,
        })
        .populate({ path: "hospital", select: "name address hospitalId" });
    }

    if (!profile || !profile.user)
      return res.status(404).json({ message: "Doctor profile or user account not found" });
    res.json(profile);
  } catch (err) {
    console.error("getDoctorById error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getPatientDetails = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const { patientId } = docReq.params;
    const callingUserId = docReq.user!._id;
    const userRole = docReq.user?.role?.trim().toLowerCase();
    const isAdmin = ["hospital-admin", "super-admin"].includes(userRole || "");

    // In single hospital, we don't need to filter by hospital IDs per doctor

    const patientProfile: any = await (
      PatientProfile.findOne({
        user: patientId,
      }) as any
    )
      .unscoped()
      .populate({
        path: "user",
        select: "name email mobile",
        options: { unscoped: true } as any,
      });

    if (!patientProfile) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    const appointmentFilter: any = { patient: patientId };
    const appointments = await (Appointment.find(appointmentFilter) as any)
      .unscoped()
      .populate({
        path: "doctor",
        populate: {
          path: "user",
          select: "name",
          options: { unscoped: true } as any,
        },
        options: { unscoped: true } as any,
      })
      .sort({ date: -1 });

    const allPrescriptions = await (
      Prescription.find({ patient: patientId }) as any
    )
      .unscoped()
      .populate({
        path: "doctor",
        populate: {
          path: "user",
          select: "name",
          options: { unscoped: true } as any,
        },
        options: { unscoped: true } as any,
      })
      .populate({ path: "appointment", options: { unscoped: true } as any })
      .sort({ createdAt: -1 });

    // Doctors and admins can see ALL history for the patient they are treating
    let prescriptions = allPrescriptions;

    const allReports = await (Report.find({ patient: patientId }) as any)
      .unscoped()
      .populate({ path: "appointment", options: { unscoped: true } as any })
      .sort({ date: -1 });

    let reports = allReports;

    if (!isAdmin) {
      reports = allReports.filter((rep: any) => {
        return true; // All reports belong to the single clinic
      });
    }

    // Fetch active IPD admission if any (search by User ID or Profile ID for robustness)
    const activeAdmission = await (
      IPDAdmission.findOne({
        patient: { $in: [patientId, patientProfile._id] },
        status: "Active",
      }) as any
    )
      .unscoped()
      .populate({
        path: "primaryDoctor",
        populate: {
          path: "user",
          select: "name",
          options: { unscoped: true } as any,
        },
        options: { unscoped: true } as any,
      });

    // ✅ PENDING ADMISSION LOOKUP: If no active admission, check for scheduled IPD appointments
    let pendingIPDAppointment: any = null;
    if (!activeAdmission) {
      pendingIPDAppointment = await (
        Appointment.findOne({
          patient: patientId,
          type: "IPD",
          status: { $in: ["Booked", "confirmed", "scheduled", "Booked Online"] },
        }) as any
      )
        .unscoped()
        .populate({
          path: "doctor",
          populate: { path: "user", select: "name" },
          options: { unscoped: true } as any,
        })
        .sort({ date: -1 });
    }

    let activeBed = {};
    let latestVitals: any = {};
    if (activeAdmission) {
      const occupancy = await (
        BedOccupancy.findOne({
          admission: activeAdmission._id,
          endDate: { $exists: false },
        }) as any
      ).unscoped();

      if (occupancy && occupancy.bed) {
        const foundBed = await (Bed.findById(occupancy.bed) as any)
          .unscoped()
          .lean();
        if (foundBed) {
          activeBed = foundBed;
      }
    }
  }

    // ✅ IDENTITY RESOLUTION: Fetch all linked patient IDs to gather complete history
    let patientIdsForSync = [patientId];
    try {
      const patientUser = await (
        Patient.findById(patientId).select("mobile") as any
      ).unscoped();
      if (patientUser?.mobile) {
        const linkedPatients = await (
          Patient.find({ mobile: patientUser.mobile }).select("_id") as any
        ).unscoped();
        patientIdsForSync = linkedPatients.map((p: any) => p._id);
      }
    } catch (idErr) {
      console.warn("Identity Resolution Failed:", idErr);
    }

    // ✅ REAL-TIME VITALS (Baseline Logic): Fetch latest vitals record for this patient identity sequence
    const vitalsRecord = await (
      VitalsRecord.findOne({
        patient: { $in: patientIdsForSync },
      }) as any
    )
      .unscoped()
      .sort({ timestamp: -1 })
      .select(
        "heartRate systolicBP diastolicBP spO2 temperature respiratoryRate glucose glucoseType status condition notes timestamp",
      )
      .lean();

    if (vitalsRecord) {
      latestVitals = {
        pulse: vitalsRecord.heartRate,
        heartRate: vitalsRecord.heartRate,
        bloodPressure: `${vitalsRecord.systolicBP}/${vitalsRecord.diastolicBP}`,
        systolicBP: vitalsRecord.systolicBP,
        diastolicBP: vitalsRecord.diastolicBP,
        spO2: vitalsRecord.spO2,
        temperature: vitalsRecord.temperature,
        respiratoryRate: vitalsRecord.respiratoryRate,
        glucose: vitalsRecord.glucose,
        glucoseType: vitalsRecord.glucoseType,
        status: vitalsRecord.status,
        condition: vitalsRecord.condition,
        notes: vitalsRecord.notes,
        timestamp: vitalsRecord.timestamp,
      };
    } else {
      // ✅ VITALS FALLBACK LADDER: Ensure UI never shows empty vitals for clinical cases
      // Fallback 1: Use vitals from active admission (initial vitals)
      if (activeAdmission?.vitals && (activeAdmission.vitals.bloodPressure || activeAdmission.vitals.pulse)) {
        latestVitals = {
          ...activeAdmission.vitals,
          bloodPressure: activeAdmission.vitals.bloodPressure,
          pulse: activeAdmission.vitals.pulse,
          status: activeAdmission.vitals.status || "Stable",
          source: "admission"
        };
      }
      // Fallback 2: Use vitals from the most recent appointment
      else if (appointments.length > 0 && appointments[0].vitals) {
        const apptVitals = appointments[0].vitals;
        latestVitals = {
          bloodPressure: apptVitals.bloodPressure || apptVitals.bp,
          temperature: apptVitals.temperature || apptVitals.temp,
          pulse: apptVitals.pulse,
          spO2: apptVitals.spO2 || apptVitals.spo2,
          height: apptVitals.height,
          weight: apptVitals.weight,
          glucose: apptVitals.glucose || apptVitals.sugar,
          status: "Stable",
          source: "appointment"
        };
      }
      // Fallback 3: Use baseline vitals from Patient Profile
      else if (patientProfile) {
        latestVitals = {
          bloodPressure: patientProfile.bloodPressure,
          temperature: patientProfile.temperature,
          pulse: patientProfile.pulse,
          spO2: patientProfile.spO2,
          height: patientProfile.height,
          weight: patientProfile.weight,
          status: patientProfile.condition || "Stable",
          source: "profile"
        };
      }
    }

    if (activeAdmission) {
      // ✅ BED HISTORY: Fetch all previous room/bed transfers for this admission
      const bedHistoryRecords = await (BedOccupancy.find({
        admission: activeAdmission._id,
      }) as any)
        .unscoped()
        .sort({ startDate: 1 })
        .populate({
            path: "bed",
            select: "bedId room type dailyRateAtTime pricePerDay pricePerHalfDay pricePerHour",
            options: { unscoped: true } as any
        })
        .lean();

      (activeAdmission as any).bedHistory = bedHistoryRecords.map((occ: any) => ({
        bedId: occ.bed?.bedId || "Unknown",
        room: occ.bed?.room || "General",
        type: occ.bed?.type || "Standard",
        startDate: occ.startDate,
        endDate: occ.endDate,
        pricePerDay: occ.dailyRateAtTime || occ.bed?.pricePerDay || 0,
        pricePerHalfDay: occ.halfDayRateAtTime !== undefined ? occ.halfDayRateAtTime : (occ.bed?.pricePerHalfDay !== undefined ? occ.bed.pricePerHalfDay : Math.round((occ.dailyRateAtTime || occ.bed?.pricePerDay || 0) / 2)),
        pricePerHour: occ.hourlyRateAtTime !== undefined ? occ.hourlyRateAtTime : (occ.bed?.pricePerHour !== undefined ? occ.bed.pricePerHour : Math.round((occ.dailyRateAtTime || occ.bed?.pricePerDay || 0) / 24)),
      }));
    }

    // Assemble clean response data
    const profileObj = patientProfile.toObject
      ? patientProfile.toObject()
      : patientProfile;

    const responseData = {
      ...profileObj,
      ...latestVitals,
      name: patientProfile.user?.name || patientProfile.name || "Unknown",
      email: patientProfile.user?.email || patientProfile.email || "N/A",
      mobile: patientProfile.user?.mobile || patientProfile.mobile || "N/A",
      bloodGroup: patientProfile.bloodGroup || "Unknown",
      personal: {
        _id: patientProfile.user?._id || patientId,
        name: patientProfile.user?.name || patientProfile.name || "Unknown",
        email: patientProfile.user?.email || patientProfile.email || "N/A",
        emergencyContactEmail: patientProfile.emergencyContactEmail || "N/A",
        mobile: patientProfile.user?.mobile || patientProfile.mobile || "N/A",
        dob: patientProfile.dob,
        age: patientProfile.age,
        gender: patientProfile.gender,
        address: patientProfile.address,
        bloodGroup: patientProfile.bloodGroup || "Unknown",
      },
      health: {
        conditions: patientProfile.conditions,
        allergies: patientProfile.allergies,
        medicalHistory: patientProfile.medicalHistory,
        medications: patientProfile.medications,
        pulse: patientProfile.pulse,
        bloodPressure: patientProfile.bloodPressure,
        spO2: patientProfile.spO2,
        temperature: patientProfile.temperature,
      },
      history: (appointments || []).map((app: any) => ({
        _id: app._id,
        date: app.date,
        reason: app.reason,
        symptoms: app.symptoms,
        doctorName:
          app.doctor?.user?.name || app.doctor?.name || "Medical Professional",
        status: app.status,
      })),
      prescriptions: (prescriptions || []).map((pres: any) => ({
        _id: pres._id,
        date: pres.createdAt,
        doctorName:
          pres.doctor?.user?.name ||
          pres.doctor?.name ||
          "Medical Professional",
        medicines: pres.medicines,
        notes: pres.notes,
      })),
      reports: (reports || []).map((rep: any) => ({
        _id: rep._id,
        name: rep.name,
        url: rep.url,
        type: rep.type,
        date: rep.date,
      })),
      admission: activeAdmission
        ? {
          admissionId: activeAdmission.admissionId,
          admissionDate: activeAdmission.admissionDate,
          type: activeAdmission.admissionType,
          bed: activeBed,
          primaryDoctor: activeAdmission.primaryDoctor,
          vitals: latestVitals,
          isPending: false
        }
        : pendingIPDAppointment
          ? {
            admissionId: "PENDING",
            admissionDate: pendingIPDAppointment.date,
            type: "IPD",
            bed: { bedId: "TBD", room: "Pending Admission", type: "N/A" },
            primaryDoctor: pendingIPDAppointment.doctor,
            vitals: latestVitals,
            isPending: true,
            appointmentId: pendingIPDAppointment._id
          }
          : null,
    };

    res.json(responseData);
  } catch (err) {
    console.error("getPatientDetails error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getPatientHistory = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const { patientId } = docReq.params;
    const { scope = "hospital" } = docReq.query;
    const isGlobal = scope === "all";

    // 1. Fetch Patient Profile
    const patientProfile = await (
      PatientProfile.findOne({
        user: patientId,
      }) as any
    ).unscoped();

    if (!patientProfile) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    // 2. Scoping logic
    let patientIds = [patientId];
    const hospitalId = docReq.user?.hospital;

    if (isGlobal) {
      // Identity Resolution: Look up all patient IDs linked by mobile number
      const patientUser = await (
        Patient.findById(patientId).select("mobile") as any
      ).unscoped();
      if (patientUser?.mobile) {
        const allLinkedPatients = await (
          Patient.find({ mobile: patientUser.mobile }).select("_id") as any
        ).unscoped();
        patientIds = allLinkedPatients.map((p: any) => p._id);
      }
    }

    // Prepare filters
    const filter: any = { patient: { $in: patientIds } };

    // If NOT global, manually enforce current hospital scoping
    // This is CRITICAL for Super Admins who otherwise bypass default scoping
    if (!isGlobal && hospitalId) {
      filter.hospital = hospitalId;
    }

    let appointmentsQuery = Appointment.find(filter).sort({ date: -1 });
    let prescriptionsQuery = Prescription.find(filter).sort({
      createdAt: -1,
    });
    let reportsQuery = Report.find(filter).sort({ date: -1 });
    let labOrdersQuery = LabOrder.find(filter).sort({ createdAt: -1 });

    // Multi-tenancy: Bypassing scoped plugin if global scope requested
    if (isGlobal) {
      appointmentsQuery = (appointmentsQuery as any).unscoped();
      prescriptionsQuery = (prescriptionsQuery as any).unscoped();
      reportsQuery = (reportsQuery as any).unscoped();
      labOrdersQuery = (labOrdersQuery as any).unscoped();
    }

    const [appointments, prescriptions, reports, labOrders] = await Promise.all([
      appointmentsQuery
        .populate({
          path: "doctor",
          populate: {
            path: "user",
            select: "name",
            options: { unscoped: true } as any,
          },
          options: { unscoped: true } as any,
        })
        .populate({ path: "hospital", select: "name address phone" }),
      prescriptionsQuery
        .populate({
          path: "doctor",
          populate: {
            path: "user",
            select: "name",
            options: { unscoped: true } as any,
          },
          options: { unscoped: true } as any,
        })
        .populate({ path: "hospital", select: "name address" })
        .populate({
          path: "admission",
          select: "primaryDoctor admissionId",
          populate: {
            path: "primaryDoctor",
            populate: { path: "user", select: "name" },
            options: { unscoped: true } as any,
          },
          options: { unscoped: true } as any,
        }),
      reportsQuery
        .populate({ path: "hospital", select: "name address" })
        .populate({
          path: "appointment",
          select: "doctor",
          populate: {
            path: "doctor",
            populate: { path: "user", select: "name" },
            options: { unscoped: true } as any,
          },
          options: { unscoped: true } as any,
        })
        .populate({
          path: "admission",
          select: "primaryDoctor",
          populate: {
            path: "primaryDoctor",
            populate: { path: "user", select: "name" },
            options: { unscoped: true } as any,
          },
          options: { unscoped: true } as any,
        }),
      labOrdersQuery
        .populate({ path: "hospital", select: "name address" })
        .populate({
          path: "prescription",
          select: "appointment doctor",
          populate: [
            {
              path: "appointment",
              select: "doctor",
              populate: {
                path: "doctor",
                populate: { path: "user", select: "name" },
                options: { unscoped: true } as any,
              },
              options: { unscoped: true } as any,
            },
            {
              path: "doctor",
              populate: { path: "user", select: "name" },
              options: { unscoped: true } as any,
            }
          ],
          options: { unscoped: true } as any,
        })
        .populate({
          path: "doctor",
          select: "name",
          options: { unscoped: true } as any,
        })
        .populate({
          path: "admission",
          select: "primaryDoctor admissionId",
          populate: {
            path: "primaryDoctor",
            populate: { path: "user", select: "name" },
            options: { unscoped: true } as any,
          },
          options: { unscoped: true } as any,
        }),
    ]);

    // Format Reports
    const formattedReports = (reports || []).map((rep: any) => ({
      _id: rep._id,
      name: rep.name,
      url: rep.url,
      type: rep.type,
      date: rep.date,
      hospitalName: rep.hospital?.name || "Original Facility",
      hospitalAddress: rep.hospital?.address || "N/A",
      suggestedPrimaryDoctor:
        rep.admission?.primaryDoctor?.user?.name ||
        rep.appointment?.doctor?.user?.name ||
        "N/A",
      source: "upload",
    }));

    // Format Lab Orders
    const formattedLabOrders = (labOrders || []).map((order: any) => ({
      _id: order._id,
      name:
        order.tests
          ?.map((t: any) => t.testName || "Laboratory Test")
          .join(", ") || "Lab Results",
      type: "Lab Result",
      date: order.completedAt || order.createdAt,
      hospitalName: order.hospital?.name || "Original Facility",
      hospitalAddress: order.hospital?.address || "N/A",
      suggestedPrimaryDoctor:
        order.admission?.primaryDoctor?.user?.name ||
        order.prescription?.appointment?.doctor?.user?.name ||
        order.prescription?.doctor?.user?.name ||
        order.doctor?.name ||
        "N/A",
      source: "system",
      status: order.status,
      results: order.tests
        ?.map((t: any) => ({
          testName: t.testName,
          result: t.result,
          isAbnormal: t.isAbnormal,
          subTests: t.subTests,
        }))
        .filter((t: any) => t.result || (t.subTests && t.subTests.length > 0)),
    }));

    res.json({
      success: true,
      history: (appointments || []).map((app: any) => ({
        _id: app._id,
        date: app.date,
        appointmentTime: app.appointmentTime || app.startTime || "N/A",
        reason: app.reason,
        symptoms: app.symptoms,
        doctorName:
          app.doctor?.user?.name || app.doctor?.name || "Medical Professional",
        hospitalName: app.hospital?.name || "Original Facility",
        hospitalAddress: app.hospital?.address || "N/A",
        amount: app.payment?.amount || app.amount || 0,
        paymentMethod: app.payment?.paymentMethod || "N/A",
        paymentStatus: app.payment?.paymentStatus || app.paymentStatus || "pending",
        status: app.status,
      })),
      prescriptions: (prescriptions || []).map((pres: any) => ({
        _id: pres._id,
        date: pres.createdAt,
        doctorName:
          pres.doctor?.user?.name ||
          pres.doctor?.name ||
          "Medical Professional",
        hospitalName: pres.hospital?.name || "Original Facility",
        hospitalAddress: pres.hospital?.address || "N/A",
        suggestedPrimaryDoctor:
          pres.admission?.primaryDoctor?.user?.name || "N/A",
        medicines: pres.medicines,
        notes: pres.notes,
      })),
      reports: [...formattedReports, ...formattedLabOrders].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    });
  } catch (err) {
    console.error("getPatientHistory error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const startNextAppointment = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const doctorId = docReq.user!._id;

    const doctorProfile = await (
      DoctorProfile.findOne({ user: doctorId }) as any
    ).unscoped();
    if (!doctorProfile) {
      return res.status(404).json({ message: "Doctor profile not found" });
    }

    await (
      Appointment.updateMany(
        { doctor: doctorProfile._id, status: "in-progress" },
        { $set: { status: "completed", queue_status: "COMPLETED" } },
      ) as any
    ).unscoped();

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const nextAppointment = await (
      Appointment.findOneAndUpdate(
        {
          doctor: doctorProfile._id,
          date: { $gte: startOfDay, $lte: endOfDay },
          status: { $in: ["confirmed", "waiting"] },
        },
        { $set: { status: "in-progress", queue_status: "CURRENT", called_time: new Date() } },
        { new: true, sort: { timeSlot: 1 } },
      ) as any
    )
      .unscoped()
      .populate({
        path: "patient",
        select: "name email mobile",
      });

    if (!nextAppointment) {
      // Also emit empty queue update since there are no more patients
      const { emitQueueUpdate } = await import("../../config/tvSocketHandler.js");
      if ((req as any).io) {
        await emitQueueUpdate((req as any).io, doctorProfile._id, doctorProfile.hospital);
      }
      return res
        .status(200)
        .json({ message: "No more confirmed appointments for today" });
    }

    const { emitQueueUpdate } = await import("../../config/tvSocketHandler.js");
    if ((req as any).io) {
      await emitQueueUpdate((req as any).io, doctorProfile._id, nextAppointment.hospital);
    }

    res.status(200).json({
      message: "Next appointment started",
      appointment: nextAppointment,
    });
  } catch (err) {
    console.error("startNextAppointment error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getDoctorCalendarStats = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const {
      month,
      year,
      view,
      startDate: queryStartDate,
      doctorId,
    } = docReq.query;

    let doctorProfile;

    if (doctorId && doctorId !== "undefined") {
      const id = doctorId as string;
      if (mongoose.Types.ObjectId.isValid(id)) {
        // Try to find by Profile ID first (likely from Helpdesk)
        doctorProfile = await (DoctorProfile.findById(id) as any).unscoped();

        // If not found, try as User ID
        if (!doctorProfile) {
          doctorProfile = await (
            DoctorProfile.findOne({ user: id }) as any
          ).unscoped();
        }
      }
    } else {
      // Default to logged-in user (for doctor portal)
      doctorProfile = await (
        DoctorProfile.findOne({ user: docReq.user!._id }) as any
      ).unscoped();
    }

    if (!doctorProfile) {
      return res.status(404).json({ message: "Doctor profile not found" });
    }

    const parseTimeVal = (t: string | undefined): { hours: number; minutes: number } | null => {
      if (!t) return null;
      const normalized = t.replace(/\s+/g, "").toLowerCase();
      
      // Handle AM/PM format
      const ampmMatch = normalized.match(/(\d+):?(\d+)?(am|pm)/);
      if (ampmMatch) {
        let h = parseInt(ampmMatch[1]);
        const m = ampmMatch[2] ? parseInt(ampmMatch[2]) : 0;
        if (h === 12) {
          if (ampmMatch[3] === "am") h = 0;
        } else if (ampmMatch[3] === "pm" && h < 12) {
          h += 12;
        }
        return { hours: h, minutes: m };
      }

      // Handle 24h format (HH:mm)
      const h24Match = normalized.match(/^(\d{1,2}):(\d{2})$/);
      if (h24Match) {
        return { hours: parseInt(h24Match[1]), minutes: parseInt(h24Match[2]) };
      }

      return null;
    };

    if (view === "weekly") {
      if (!queryStartDate) {
        return res
          .status(400)
          .json({ message: "startDate is required for weekly view" });
      }

      const start = new Date(queryStartDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);

      const appointments = await (
        Appointment.find({
          doctor: doctorProfile._id,
          date: { $gte: start, $lte: end },
          status: { $ne: "cancelled" },
        }) as any
      ).unscoped();

      let minHour = 9;
      let maxHour = 21;

      if (doctorProfile.availability && doctorProfile.availability.length > 0) {
        let foundAvailability = false;
        let earliest = 24;
        let latest = 0;

        doctorProfile.availability.forEach((a) => {
          if (a.startTime && a.endTime) {
            const start = parseTimeVal(a.startTime);
            const end = parseTimeVal(a.endTime);

            if (start && end) {
              if (start.hours < earliest) earliest = start.hours;
              if (end.hours > latest) latest = end.hours;
              if (end.minutes > 0 && end.hours >= latest) latest = end.hours + 1;
              foundAvailability = true;
            }
          }
        });

        if (foundAvailability) {
          minHour = earliest;
          maxHour = latest;
        }
      }

      const timeSlots: string[] = [];
      for (let h = minHour; h <= maxHour; h++) {
        const startH = h;
        const endH = h + 1;
        const formatH = (hour: number) => {
          const ampm = hour >= 12 ? "PM" : "AM";
          const h12 = hour % 12 || 12;
          return `${h12}:00 ${ampm}`;
        };
        timeSlots.push(`${formatH(startH)} - ${formatH(endH)}`);
      }

      const days: any[] = [];
      const current = new Date(start);
      for (let i = 0; i < 7; i++) {
        days.push({
          date: new Date(current),
          dayName: current.toLocaleDateString("en-US", { weekday: "long" }),
          slots: {},
          dailyTotal: 0,
        });
        current.setDate(current.getDate() + 1);
      }

      const weeklyTotals: any = {};
      timeSlots.forEach((slot) => (weeklyTotals[slot] = 0));
      let grandTotal = 0;
      const HOURLY_LIMIT = 12;

      const [leaves, masterLeaves] = await Promise.all([
        Leave.find({
          requester: doctorProfile.user,
          status: "approved",
          $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }],
        }),
        MasterDoctorLeave.find({
          doctor: doctorProfile.user,
          status: "approved",
          $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }],
        })
      ]);

      const allLeaves = [...leaves, ...masterLeaves];

      appointments.forEach((app) => {
        const appDate = new Date(app.date);
        const appDateStr = appDate.toDateString();

        const dayObj = days.find((d) => d.date.toDateString() === appDateStr);
        if (dayObj) {
          // Increment total count regardless of whether it matches a specific time slot due to doctor availability
          // This ensures the chart reflects actual volume even if appointments are outside standard hours
          dayObj.dailyTotal++;
          grandTotal++;


          const timeObj = parseTimeVal(app.startTime as string);
          if (!timeObj) return;
          const h = timeObj.hours;
          const formatH = (hour: number) => {
            const ampm = hour >= 12 ? "PM" : "AM";
            const h12 = hour % 12 || 12;
            return `${h12}:00 ${ampm}`;
          };
          const slotStartStr = `${formatH(h)}`;
          const matchingSlot = timeSlots.find((s) =>
            s.startsWith(slotStartStr),
          );

          if (matchingSlot) {
            if (!dayObj.slots[matchingSlot])
              dayObj.slots[matchingSlot] = { count: 0, isFull: false };
            dayObj.slots[matchingSlot].count++;
            if (dayObj.slots[matchingSlot].count >= HOURLY_LIMIT) {
              dayObj.slots[matchingSlot].isFull = true;
            }
            weeklyTotals[matchingSlot]++;
          }
        }
      });

      // 3. Mark holiday/unavailable days and calculate slot status
      days.forEach((day) => {
        const dayName = day.dayName;
        
        // Find all availability records that include this day
        const dayAvailabilities = (doctorProfile.availability || []).filter(
          (a: any) => a.days && a.days.includes(dayName)
        );

        // Check if doctor is on leave
        const dayOnLeave = allLeaves.some(leave => {
          const lStart = new Date(leave.startDate);
          lStart.setHours(0,0,0,0);
          const lEnd = new Date(leave.endDate);
          lEnd.setHours(23,59,59,999);
          const current = new Date(day.date);
          current.setHours(0,0,0,0);
          return current >= lStart && current <= lEnd;
        });

        if (dayOnLeave) {
          day.isLeave = true;
          timeSlots.forEach((slot) => {
            day.slots[slot] = { count: 0, isFull: true, isLeave: true };
          });
          return;
        }

        if (dayAvailabilities.length === 0) {
          day.isNotAvailable = true;
          timeSlots.forEach((slot) => {
            day.slots[slot] = { count: 0, isFull: true };
          });
          return;
        }

        // For each slot, check if it falls within ANY of the day's availabilities
        timeSlots.forEach((slot) => {
          const [sStart, sEnd] = slot.split(" - ");
          const slotStartObj = parseTimeVal(sStart);
          if (!slotStartObj) return;

          // Check if slot falls within any work shift
          const inShift = dayAvailabilities.some(avail => {
            const shiftStart = parseTimeVal(avail.startTime);
            const shiftEnd = parseTimeVal(avail.endTime);
            return shiftStart && shiftEnd && 
                   slotStartObj.hours >= shiftStart.hours && slotStartObj.hours < shiftEnd.hours;
          });

          // Check if slot falls within any break
          const inBreak = dayAvailabilities.some(avail => {
            const breakStart = parseTimeVal(avail.breakStart);
            const breakEnd = parseTimeVal(avail.breakEnd);
            return breakStart && breakEnd && 
                   slotStartObj.hours >= breakStart.hours && slotStartObj.hours < breakEnd.hours;
          });

          if (!inShift) {
            day.slots[slot] = { count: 0, isFull: true };
          } else if (inBreak) {
            if (!day.slots[slot]) day.slots[slot] = { count: 0, isFull: true };
            day.slots[slot].isFull = true;
            day.slots[slot].isBreak = true;
          } else {
            // Available or has appointments (appointments already populated counts)
            if (!day.slots[slot]) day.slots[slot] = { count: 0, isFull: false };
          }
        });
      });

      days.forEach((day) => {
        timeSlots.forEach((slot) => {
          if (!day.slots[slot]) {
            day.slots[slot] = { count: 0, isFull: false };
          }
        });
      });

      return res.json({
        timeSlots,
        days,
        weeklyTotals: { ...weeklyTotals, total: grandTotal },
      });
    }

    if (!month || !year) {
      return res.status(400).json({ message: "Month and year are required" });
    }

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

    const appointments = await Appointment.aggregate([
      {
        $match: {
          doctor: doctorProfile._id,
          date: { $gte: startDate, $lte: endDate },
          status: { $ne: "cancelled" },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          count: { $sum: 1 },
        },
      },
    ]);

    const leaves = await Leave.find({
      requester: doctorProfile.user,
      status: "approved",
      $or: [{ startDate: { $lte: endDate }, endDate: { $gte: startDate } }],
    });

    const stats: any = {};
    appointments.forEach((app) => {
      stats[app._id] = { count: app.count, isLeave: false };
    });

    leaves.forEach((leave) => {
      let current = new Date(leave.startDate);
      const end = new Date(leave.endDate);

      while (current <= end) {
        if (current >= startDate && current <= endDate) {
          const dateStr = current.toISOString().split("T")[0];
          if (!stats[dateStr]) {
            stats[dateStr] = { count: 0, isLeave: true };
          } else {
            stats[dateStr].isLeave = true;
          }
        }
        current.setDate(current.getDate() + 1);
      }
    });

    res.json(stats);
  } catch (err) {
    console.error("getDoctorCalendarStats error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getDoctorAppointmentsByDate = async (
  req: Request,
  res: Response,
) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const { date } = docReq.query;
    if (!date) return res.status(400).json({ message: "Date is required" });

    const doctorProfile = await (
      (DoctorProfile as any).findOne({
        user: docReq.user!._id,
      })
    )
      .unscoped()
      .select("_id")
      .lean();
    if (!doctorProfile)
      return res.status(404).json({ message: "Doctor profile not found" });

    const searchDate = new Date(date as string);
    const startOfDay = new Date(searchDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(searchDate.setHours(23, 59, 59, 999));

    const appointments = await (
      Appointment.find({
        doctor: doctorProfile._id,
        date: { $gte: startOfDay, $lte: endOfDay },
        status: { $ne: "cancelled" },
      }) as any
    )
      .unscoped()
      .populate({
        path: "patient",
        select: "name email mobile",
      })
      .populate("hospital", "name address")
      .sort({ date: 1 });

    res.json(appointments);
  } catch (err) {
    console.error("getDoctorAppointmentsByDate error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const addQuickNote = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const { text } = docReq.body;
    if (!text)
      return res.status(400).json({ message: "Note text is required" });

    const role = docReq.user!.role?.toLowerCase();
    const ProfileModel = role === "nurse" ? StaffProfile : DoctorProfile;

    const profile = await (
      (ProfileModel as any).findOneAndUpdate(
        { user: docReq.user!._id },
        {
          $push: {
            quickNotes: {
              text,
              timestamp: new Date(),
            },
          },
        },
        { new: true },
      ) as any
    ).unscoped();

    if (!profile || !profile.quickNotes) {
      return res.status(404).json({ message: `${role === 'nurse' ? 'Nurse' : 'Doctor'} profile not found` });
    }

    const newNote = profile.quickNotes[profile.quickNotes.length - 1];
    res.status(201).json(newNote);
  } catch (err) {
    console.error("addQuickNote error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getQuickNotes = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const role = docReq.user!.role?.toLowerCase();
    const ProfileModel = role === "nurse" ? StaffProfile : DoctorProfile;

    const profile = await (
      (ProfileModel as any).findOne({ user: docReq.user!._id })
    )
      .unscoped()
      .select("quickNotes")
      .lean();

    if (!profile) {
      return res.status(404).json({ message: `${role === 'nurse' ? 'Nurse' : 'Doctor'} profile not found` });
    }
    const notes = (profile.quickNotes || []).sort(
      (a: any, b: any) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    res.json(notes);
  } catch (err) {
    console.error("getQuickNotes error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteQuickNote = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const { id } = docReq.params;
    const role = docReq.user!.role?.toLowerCase();
    const ProfileModel = role === "nurse" ? StaffProfile : DoctorProfile;

    const profile = await (
      (ProfileModel as any).findOneAndUpdate(
        { user: docReq.user!._id },
        { $pull: { quickNotes: { _id: id } } },
        { new: true },
      ) as any
    ).unscoped();

    if (!profile) {
      return res.status(404).json({ message: `${role === 'nurse' ? 'Nurse' : 'Doctor'} profile not found` });
    }

    res.json({ message: "Note deleted" });
  } catch (err) {
    console.error("deleteQuickNote error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getDoctorPatients = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const userId = docReq.user!._id;
    const doctorProfile = await (
      DoctorProfile.findOne({ user: userId }) as any
    ).unscoped();

    if (!doctorProfile) {
      return res.json({
        data: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const sortOrder = req.query.sort === "oldest" ? 1 : -1;
    const searchQuery = req.query.search as string;

    const currentHospitalId = new mongoose.Types.ObjectId(
      docReq.user!.hospital as unknown as string,
    );

    // Aggregation to find unique patients for this doctor
    const pipeline: any[] = [
      { $match: { doctor: doctorProfile._id } },
      { $sort: { date: -1, createdAt: -1 } },
      {
        $group: {
          _id: "$patient",
          lastVisit: { $first: "$date" },
          lastReason: { $first: "$reason" },
          lastType: { $first: "$type" },
          lastIsIPD: { $first: "$isIPD" },
        },
      },
      {
        $lookup: {
          from: "patients",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      { $unwind: "$userInfo" },
      {
        $lookup: {
          from: "patientprofiles",
          localField: "_id",
          foreignField: "user",
          as: "profileInfo",
        },
      },
      {
        $addFields: {
          profileInfo: {
            $filter: {
              input: "$profileInfo",
              as: "profile",
              cond: { $eq: ["$$profile.hospital", currentHospitalId] },
            },
          },
        },
      },
      { $unwind: { path: "$profileInfo", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "ipdadmissions",
          let: { patientId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$patient", "$$patientId"] },
                    { $eq: ["$status", "Active"] },
                  ],
                },
              },
            },
          ],
          as: "activeAdmissions",
        },
      },
      {
        $addFields: {
          patientType: {
            $cond: {
              if: {
                $or: [
                  { $eq: ["$lastIsIPD", true] },
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$lastType", ""] },
                      regex: /^IPD$/i,
                    },
                  },
                  { $gt: [{ $size: "$activeAdmissions" }, 0] },
                ],
              },
              then: "IPD",
              else: "OPD",
            },
          },
          isAdmissionActive: { $gt: [{ $size: "$activeAdmissions" }, 0] },
        },
      },
    ];

    // Search Filter
    if (searchQuery) {
      pipeline.push({
        $match: {
          $or: [
            { "userInfo.name": { $regex: searchQuery, $options: "i" } },
            { "profileInfo.mrn": { $regex: searchQuery, $options: "i" } },
            { "userInfo.mobile": { $regex: searchQuery, $options: "i" } },
          ],
        },
      });
    }

    // Type Filter (IPD/OPD)
    const typeFilter = req.query.type as string;
    if (typeFilter) {
      pipeline.push({
        $match: {
          patientType: typeFilter,
        },
      });
    }

    // Count for pagination
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Appointment.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;
    const totalPages = Math.ceil(total / limit);

    // Sorting, Skip, and Limit
    pipeline.push({ $sort: { lastVisit: sortOrder } });
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    const results = await Appointment.aggregate(pipeline);

    const patients = results.map((r) => {
      let age = r.profileInfo?.age;
      if (!age && r.profileInfo?.dob) {
        const diff = Date.now() - new Date(r.profileInfo.dob).getTime();
        age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
      }

      return {
        id: r._id,
        name: r.userInfo?.name || "Unknown",
        mobile: r.userInfo?.mobile || "N/A",
        email: r.userInfo?.email || "N/A",
        mrn: r.profileInfo?.mrn || "N/A",
        age: age,
        gender: r.profileInfo?.gender,
        lastVisit: r.lastVisit,
        condition:
          r.lastReason ||
          r.profileInfo?.medicalHistory?.split(",")[0] ||
          "Regular Checkup",
        patientType: r.patientType || "OPD",
        isAdmissionActive: r.isAdmissionActive || false,
      };
    });

    res.json({
      data: patients,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (err) {
    console.error("getDoctorPatients error:", err);
    res.status(500).json({ message: "Failed to fetch patients" });
  }
};
export const getDoctorAnalytics = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    if (!docReq.user || !docReq.user._id)
      return res.status(401).json({ message: "Unauthorized" });

    let doctorProfile = await (
      (DoctorProfile as any).findOne({ user: docReq.user._id })
    )
      .unscoped()
      .select("_id")
      .lean();

    if (!doctorProfile) {
      const user = await (User.findById(docReq.user._id) as any).unscoped();
      if (user && user.role === "doctor") {
        const newProfile = await DoctorProfile.create({
          user: user._id,
          hospital: user.hospital || null,
        });
        doctorProfile = newProfile.toObject();
      } else {
        return res.status(404).json({ message: "Doctor profile not found" });
      }
    }

    const analytics = await doctorService.getAnalytics(
      doctorProfile._id.toString(),
    );
    res.json(analytics);
  } catch (err: any) {
    console.error("getDoctorAnalytics error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

export const getDoctorIncomeStats = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const { startDate, endDate } = req.query;

    const doctorProfile = await (
      (DoctorProfile as any).findOne({ user: docReq.user!._id })
    ).unscoped();
    if (!doctorProfile)
      return res.status(404).json({ message: "Doctor profile not found" });

    // Use current day as default when dates not provided
    let sDate: Date;
    let eDate: Date;

    if (startDate) {
      const [y, m, d] = (startDate as string).split("-").map(Number);
      sDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      sDate = new Date();
      sDate.setHours(0, 0, 0, 0);
    }

    if (endDate) {
      const [y, m, d] = (endDate as string).split("-").map(Number);
      eDate = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else {
      eDate = new Date(sDate);
      eDate.setHours(23, 59, 59, 999);
    }

    const appointments = await (
      Appointment.find({
        doctor: doctorProfile._id,
        date: { $gte: sDate, $lte: eDate },
        status: { $nin: ["cancelled", "deleted", "Cancelled"] },
      }) as any
    ).unscoped();

    let opdCount = 0;
    let ipdCount = 0;
    let opdRevenue = 0;
    let ipdRevenue = 0;

    appointments.forEach((apt: any) => {
      const type = String(apt.type || apt.visitType || "OPD").toUpperCase();
      const isIpd = [
        "IPD",
        "INPATIENT",
        "EMERGENCY",
        "WARD",
        "ADMISSION",
      ].includes(type);

      let aptFee = apt.payment?.amount || apt.amount || 0;

      if (isIpd) {
        ipdCount++;
        ipdRevenue += aptFee;
      } else {
        opdCount++;
        opdRevenue += aptFee || doctorProfile.consultationFee || 0;
      }
    });

    const fee = doctorProfile.consultationFee || 0;
    const totalCount = opdCount + ipdCount;
    const consultationsValue = opdRevenue + ipdRevenue;

    res.json({
      startDate: sDate,
      endDate: eDate,
      opdCount,
      ipdCount,
      totalCount,
      consultationFee: fee,
      opdRevenue,
      ipdRevenue,
      consultationsValue,
    });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
};

export const uploadPhoto = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    if (!docReq.user || !docReq.user._id)
      return res.status(401).json({ message: "Unauthorized" });

    if (!req.file) {
      return res.status(400).json({ message: "No image provided" });
    }

    const doctorUser = await (
      (User as any).findById(docReq.user._id)
    ).unscoped();
    if (!doctorUser) {
      return res.status(404).json({ message: "Doctor user not found" });
    }

    const doctorProfile = await (
      (DoctorProfile as any).findOne({ user: docReq.user._id })
    ).unscoped();
    if (!doctorProfile) {
      return res.status(404).json({ message: "Doctor profile not found" });
    }

    const publicId = `doctor_profiles/${docReq.user._id}_${Date.now()}`;
    const result = await uploadToCloudinary(req.file.buffer, {
      public_id: publicId,
      folder: "doctor_profiles",
    });

    doctorProfile.profilePic = result.secure_url;
    doctorUser.avatar = result.secure_url;
    doctorUser.image = result.secure_url;

    await tenantLocalStorage.run(
      {
        tenantId: doctorProfile.hospital,
        userId: docReq.user._id,
        role: docReq.user.role,
        isSuperAdmin: (docReq.user.role as string) === "super-admin",
      },
      async () => {
        await doctorProfile.save();
        await (doctorUser as any).save();
      },
    );

    // 🚀 CACHE: Clear profile cache
    const cacheKey = `doctor:profile:${docReq.user._id}`;
    await redisService.del(cacheKey);

    // Populate for response consistency
    const populatedProfile = await doctorProfile.populate({
      path: "user",
      select: "name email mobile doctorId gender dateOfBirth image avatar",
      options: { unscoped: true } as any,
    });

    const profileObj = populatedProfile.toObject() as any;
    const decryptedProfile = decryptObject(profileObj);
    res.status(200).json(decryptedProfile);
  } catch (error: any) {
    console.error("uploadPhoto error:", error);
    res.status(500).json({
      message: "Failed to upload photo",
      error: error.message,
    });
  }
};

export const updateDoctorStatus = async (req: Request, res: Response) => {
  const docReq = req as unknown as DoctorRequest;
  try {
    const { isOnline } = req.body;
    if (typeof isOnline !== "boolean") {
      return res.status(400).json({ message: "Invalid status value" });
    }

    let profile = await (
      DoctorProfile.findOne({ user: docReq.user!._id }) as any
    ).unscoped();

    if (!profile) {
      return res.status(404).json({ message: "Doctor profile not found" });
    }

    profile.isOnline = isOnline;
    await profile.save();

    // Cache Invalidation
    const cacheKey = `doctor:dashboard:${docReq.user!._id}`;
    const profileCacheKey = `doctor:profile:${docReq.user!._id}`;
    await Promise.all([
      redisService.del(cacheKey),
      redisService.del(profileCacheKey)
    ]);

    // WebSocket Broadcast
    try {
      const io = (req as any).io || req.app.get("io");
      if (io) {
        const hospitalRoom = `hospital_${profile.hospital}`;
        io.to(hospitalRoom).emit("doctor:status_changed", {
          doctorId: profile._id,
          userId: docReq.user!._id,
          isOnline,
        });
        console.log(`[Socket] Broadcasted doctor:status_changed to room ${hospitalRoom}: isOnline=${isOnline}`);
      }
    } catch (socketErr) {
      console.error("Socket emit error:", socketErr);
    }

    res.json({ message: "Status updated successfully", isOnline: profile.isOnline });
  } catch (err: any) {
    console.error("updateDoctorStatus error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
