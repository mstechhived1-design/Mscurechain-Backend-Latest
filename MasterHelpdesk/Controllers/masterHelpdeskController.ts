import { Request, Response } from "express";
import mongoose from "mongoose";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import User from "../../Auth/Models/User.js";
import Patient from "../../Patient/Models/Patient.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import * as crypto from "crypto";
import bcrypt from "bcrypt";
import MrnCounter from "../../Hospital/Models/MrnCounter.js";
import MobileAppointment from "../../Appointment/Models/MobileAppointment.js";
import { MasterHelpdeskRequest } from "../types/index.js";
import redisService from "../../config/redis.js";
import Transaction from "../../Admin/Models/Transaction.js";
import StaffProfile from "../../Staff/Models/StaffProfile.js";
import { generateTransactionId, generateReceiptNumber, generateMrn } from "../../utils/idGenerator.js";
import { resolvePatientIdentity } from "../../utils/identityResolver.js";
import helpdeskService from "../../services/helpdesk.service.js";
import masterHelpdeskService from "../Services/masterHelpdeskService.js";


const invalidateIPDCache = async (
  hospitalId: string,
  bedIds?: string | string[],
) => {
  const promises = [
    redisService.del(`ipd:admissions:active:${hospitalId}`),
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



export const registerPatient = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const result = await masterHelpdeskService.registerPatient(
      req.body,
      req.user,
      req.hospitalId,
      (req as any).io
    );
    res.status(201).json(result);
  }
);


export const getMasterHelpdeskMe = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    if (!req.user) throw new ApiError(401, "Not authenticated");

    const userId = (req.user as any)._id;
    console.log(
      "[getMasterHelpdeskMe] Fetching profile for Master Helpdesk user:",
      userId,
    );

    const hd = await (User.findOne({
      _id: userId,
      role: { $in: ["masterhelpdesk", "super-admin"] },
    }) as any).unscoped().populate("hospital", "name _id rooms departments");

    if (!hd) throw new ApiError(404, "Profile not found");

    // Fetch associated StaffProfile for bank and tax details
    const profile = await (StaffProfile.findOne({ user: userId }) as any)
      .unscoped()
      .lean();
    console.log("[getMasterHelpdeskMe] StaffProfile found:", !!profile);

    res.json({
      id: hd._id,
      name: hd.name,
      email: hd.email,
      mobile: hd.mobile,
      address: (hd as any).address,
      gender: (hd as any).gender,
      image: (hd as any).image,
      dateOfBirth: (hd as any).dateOfBirth,
      hospital: hd.hospital,
      // Profile fields from StaffProfile
      bankDetails: profile?.bankDetails || {},
      panNumber: profile?.panNumber || "",
      aadharNumber: profile?.aadharNumber || "",
      pfNumber: profile?.pfNumber || "",
      esiNumber: profile?.esiNumber || "",
      uanNumber: profile?.uanNumber || "",
      baseSalary: profile?.baseSalary || 0,
      designation: profile?.designation || "Master Helpdesk Executive",
      experienceYears: profile?.experienceYears || "",
    });
  },
);

export const updateMasterHelpdeskProfile = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    if (!req.user) throw new ApiError(401, "Not authenticated");

    const userId = (req.user as any)._id;
    console.log(
      "[updateMasterHelpdeskProfile] Updating profile for Master Helpdesk user:",
      userId,
    );

    const helpdesk = await (User.findOne({
      _id: userId,
      role: { $in: ["masterhelpdesk", "super-admin"] },
    }) as any).unscoped();
    if (!helpdesk) throw new ApiError(404, "User not found");

    const {
      name,
      email,
      mobile,
      address,
      gender,
      dateOfBirth,
      image,
      bankDetails,
      panNumber,
      aadharNumber,
      pfNumber,
      esiNumber,
      uanNumber,
      baseSalary,
      experienceYears,
      designation,
    } = req.body;

    // 1. Update Core User Model
    if (name) helpdesk.name = name;
    if (email) helpdesk.email = email;
    if (mobile) helpdesk.mobile = mobile;
    if (address !== undefined) (helpdesk as any).address = address;
    if (gender !== undefined) (helpdesk as any).gender = gender;
    if (dateOfBirth) (helpdesk as any).dateOfBirth = dateOfBirth;
    if (image !== undefined) (helpdesk as any).image = image;

    // 2. Update or Create StaffProfile for institutional details
    let profile = await (StaffProfile.findOne({ user: userId }) as any)
      .unscoped();

    if (!profile) {
      console.log(
        "[updateMasterHelpdeskProfile] Creating new StaffProfile...",
      );
      const hospitalId =
        helpdesk.hospital ||
        (req as any).hospitalId ||
        req.headers["x-hospital-id"];

      if (!hospitalId) {
        throw new ApiError(
          400,
          "Hospital context required to initialize profile",
        );
      }

      profile = new StaffProfile({
        user: userId,
        hospital: hospitalId,
        qrSecret: crypto.randomBytes(32).toString("hex"),
        status: "active",
        designation: designation || "Master Helpdesk Executive",
      });
    }

    if (bankDetails) profile.bankDetails = bankDetails;
    if (panNumber) profile.panNumber = panNumber;
    if (aadharNumber) profile.aadharNumber = aadharNumber;
    if (pfNumber) profile.pfNumber = pfNumber;
    if (esiNumber) profile.esiNumber = esiNumber;
    if (uanNumber) profile.uanNumber = uanNumber;
    if (baseSalary !== undefined) profile.baseSalary = Number(baseSalary) || 0;
    if (experienceYears !== undefined) {
      profile.experienceYears = Number(experienceYears) || 0;
    }
    if (designation) profile.designation = designation;

    try {
      console.log("[updateMasterHelpdeskProfile] Saving User and Profile...");
      await Promise.all([helpdesk.save(), profile.save()]);

      res.json({
        id: helpdesk._id,
        name: helpdesk.name,
        email: helpdesk.email,
        mobile: helpdesk.mobile,
        profileUpdated: true,
      });
    } catch (err: any) {
      console.error("[updateMasterHelpdeskProfile] Save Error:", err.message);
      if (err.code === 11000) {
        if (err.keyPattern && err.keyPattern.mobile) {
          throw new ApiError(
            400,
            "This phone number is already registered with another user.",
          );
        }
        throw new ApiError(400, "Duplicate field value entered");
      }
      throw err;
    }
  },
);

// ─── GLOBAL DASHBOARD ────────────────────────────────────────────────────────
export const getMasterDashboard = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const hospitalId = (req.query.hospitalId as string) || (req as any).hospitalId || (req.user as any)?.hospital;
    if (!hospitalId && (req.user as any)?.role !== 'super-admin') {
      throw new ApiError(400, "Hospital context is required");
    }
    const data = await masterHelpdeskService.getDashboardStats(hospitalId);
    res.json(data);
  },
);

// ─── GLOBAL APPOINTMENT QUEUE ────────────────────────────────────────────────
export const getMasterQueue = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const hospitalId = (req.query.hospitalId as string) || (req as any).hospitalId || (req.user as any)?.hospital;
    if (!hospitalId && (req.user as any)?.role !== 'super-admin') {
      throw new ApiError(400, "Hospital context is required");
    }
    const query: any = {};
    if (req.query.status) query.status = req.query.status;
    if (hospitalId) query.hospital = hospitalId;
    if (req.query.startDate) query.startDate = req.query.startDate;
    if (req.query.endDate) query.endDate = req.query.endDate;
    if (req.query.doctorId) query.doctorId = req.query.doctorId;

    const data = await masterHelpdeskService.getQueue(query, page, limit);
    res.json(data);
  },
);

// ─── GLOBAL TRANSACTIONS ────────────────────────────────────────────────────
export const getMasterTransactions = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const hospitalId = (req.query.hospitalId as string) || (req as any).hospitalId || (req.user as any)?.hospital;
    if (!hospitalId && (req.user as any)?.role !== 'super-admin') {
      throw new ApiError(400, "Hospital context is required");
    }
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const type = req.query.type as string;
    const search = req.query.search as string;
    const paymentMode = req.query.paymentMode as string;

    const data = await masterHelpdeskService.getTransactions(
      page,
      limit,
      hospitalId,
      startDate,
      endDate,
      type,
      search,
      paymentMode,
      req.query.doctorId as string
    );
    res.json(data);
  },
);

// ─── GLOBAL PATIENT MANAGEMENT ──────────────────────────────────────────────
export const getMasterPatients = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const hospitalId = (req.query.hospitalId as string) || (req as any).hospitalId || (req.user as any)?.hospital;
    if (!hospitalId && (req.user as any)?.role !== 'super-admin') {
      throw new ApiError(400, "Hospital context is required");
    }

    const data = await masterHelpdeskService.getPatients(search, page, limit, hospitalId);
    res.json(data);
  },
);

// ─── DELETE APPOINTMENT ──────────────────────────────────────────────────────
export const deleteMasterAppointment = asyncHandler(
  async (req: MasterHelpdeskRequest, res: Response) => {
    const { id } = req.params;
    const hospitalId = (req as any).hospitalId || (req.user as any)?.hospital;
    
    if (!hospitalId && (req.user as any)?.role !== 'super-admin') {
      throw new ApiError(400, "Hospital context is required");
    }

    const result = await masterHelpdeskService.deleteAppointment(id, hospitalId);
    res.json(result);
  }
);

// Existing re-exports/aliases for patient management if needed
// Re-export shared controller functions from Helpdesk FrontDesk
export {
  getPatientById,
  updatePatient,
  deletePatient,
  getTodayVisits,
  getPatientVisitHistory,
  getActiveAppointments,
  getAllAppointments,
  getPatientIPDAdmissions,
} from "../../Helpdesk/Controllers/frontDeskController.js";