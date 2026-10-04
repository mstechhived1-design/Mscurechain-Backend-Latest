import mongoose from "mongoose";
import { Request, Response } from "express";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import User from "../../Auth/Models/User.js";
import Patient from "../../Patient/Models/Patient.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import bcrypt from "bcrypt";
import redisService from "../../config/redis.js";
import Transaction from "../../Admin/Models/Transaction.js";
import MobileAppointment from "../../Appointment/Models/MobileAppointment.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Leave from "../../Leave/Models/Leave.js";
import MasterDoctorLeave from "../../MasterHelpdesk/Models/MasterDoctorLeave.js";
import { HelpdeskRequest } from "../types/index.js";
import {
  generateTransactionId,
  generateReceiptNumber,
  generateMrn,
} from "../../utils/idGenerator.js";
import { sanitizePatientName } from "../../utils/sanitizer.js";

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

// Helper to generate User Credentials
const generateCredentials = (
  name: string,
  mobile: string,
  dob?: string | Date,
) => {
  const cleanName = name
    .split(" ")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const last4Mobile = mobile.slice(-4);
  const username = `${cleanName}${last4Mobile}`;
  let password = `Pass${last4Mobile}@`;
  if (dob) {
    const d = new Date(dob as string);
    if (!isNaN(d.getTime())) {
      const day = d.getDate().toString().padStart(2, "0");
      const month = (d.getMonth() + 1).toString().padStart(2, "0");
      const year = d.getFullYear();
      password = `${day}${month}${year}`;
    }
  }
  return { username, password };
};

// Helper to generate IDs
const generateId = (prefix: string) => {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${timestamp}-${random}`;
};

export const registerPatient = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    console.log("[DEBUG] registerPatient incoming body:", req.body);
    console.time("registerPatientDuration");
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
        maritalStatus,
        bloodGroup,
        conditions,
        allergies,
        medications,
        medicalHistory,
        symptoms,
        reason,
        department,
        doctorId,
        visitType,
        appointmentDate,
        appointmentTime,
        time,
        amount,
        paymentMethod,
        paymentStatus,
        emergencyContact,
        emergencyContactName,
        emergencyContactEmail,
        receiptNumber,
        guardianName,
        guardianRelation,
        guardianMobile,
        doctorReference,
      } = req.body;
      const vitalsInput = req.body.vitals || {};
      const finalVitals = {
        height: vitalsInput.height || height,
        weight: vitalsInput.weight || weight,
        bloodPressure:
          vitalsInput.bloodPressure || vitalsInput.bp || bp || bloodPressure,
        temperature: vitalsInput.temperature || temperature,
        pulse: vitalsInput.pulse || vitalsInput.pulseRate || pulse || pulseRate,
        spO2: vitalsInput.spO2 || vitalsInput.spo2 || spO2 || spo2,
        sugar: vitalsInput.sugar || sugar,
      };
      let allergiesString = "";
      if (allergies) {
        if (Array.isArray(allergies)) {
          allergiesString = allergies.filter((a: any) => a).join(", ");
        } else {
          allergiesString = String(allergies);
        }
      }
      const paymentInput = req.body.payment || {
        amount,
        paymentMethod,
        paymentStatus,
      };
      const visitTypeInput = req.body.visitType || req.body.type || "offline";
      let finalDoctorId = doctorId;
      let doctorProfile: any = null;
      if (doctorId) {
        doctorProfile = await (
          DoctorProfile.findById(doctorId) as any
        ).unscoped();
        if (!doctorProfile) {
          doctorProfile = await (
            DoctorProfile.findOne({ user: doctorId }) as any
          ).unscoped();
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
      const helpdesk = req.user as any;
      const hospitalId = helpdesk.hospital;
      // Build search criteria: Name + (Mobile or Email)
      const nameRegex = { $regex: new RegExp(`^${name}$`, "i") };
      const searchCriteria: any = {
        name: nameRegex,
        $or: [{ mobile }],
      };
      if (email) {
        searchCriteria.$or.push({ email: email.toLowerCase() });
      }
      let user = await (Patient.findOne(searchCriteria) as any).unscoped();
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
      let generatedPassword = "";
      if (!user) {
        let passwordDob = dob;
        if (!passwordDob && age) {
          const d = new Date();
          d.setFullYear(d.getFullYear() - Number(age));
          passwordDob = d;
        }
        const { password } = generateCredentials(name, mobile, passwordDob);
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
        console.log(
          `[registerPatient] Found existing patient with mobile ${mobile}. Reusing...`,
        );
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
        const creds = generateCredentials(
          name || user.name,
          mobile,
          dob || patientProfile?.dob,
        );
        generatedPassword = creds.password;
      }
      if (!patientProfile) {
        patientProfile = await (
          PatientProfile.findOne({
            user: user._id,
            hospital: hospitalId,
          }) as any
        ).unscoped();
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
          emergencyContactName: emergencyContactName || "N/A",
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
          sugar: finalVitals.sugar,
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
      const adDate = appointmentDate
        ? new Date(appointmentDate as string)
        : new Date();
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
      let finalPaymentStatus = paymentInput.paymentStatus || "pending";
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
          finalPaymentStatus = existingAdmission.paymentStatus || "pending";
          console.log(
            `[Register Patient] Found IPD admission ${existingAdmission.admissionId}, syncing payment: ₹${finalPaymentAmount}`,
          );
        }
      }
      if (finalDoctorId) {
        const [activeAdmission, runningConsultation] = await Promise.all([
          (
            IPDAdmission.findOne({
              patient: user._id,
              hospital: hospitalId,
              status: { $in: ["Active", "Discharge Initiated"] },
            }) as any
          ).unscoped(),
          (
            Appointment.findOne({
              patient: user._id,
              status: "in-progress",
            }) as any
          ).unscoped(),
        ]);
        if (activeAdmission || runningConsultation) {
          console.warn(
            `[REGISTRATION] Patient ${user._id} has active engagement but booking allowed by user request.`,
          );
        }
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // CHECK FOR DOCTOR LEAVE
        const startOfAdDate = new Date(adDate);
        startOfAdDate.setHours(0, 0, 0, 0);
        const endOfAdDate = new Date(adDate);
        endOfAdDate.setHours(23, 59, 59, 999);
        const doctorUserId = doctorProfile?.user || finalDoctorId;
        const isLeave = await (
          Leave.findOne({
            requester: doctorUserId,
            status: "approved",
            $or: [
              {
                startDate: { $lte: endOfAdDate },
                endDate: { $gte: startOfAdDate },
              },
            ],
          }) as any
        ).unscoped();
        const isMasterLeave = await MasterDoctorLeave.findOne({
          doctor: doctorUserId,
          status: "approved",
          $or: [
            {
              startDate: { $lte: endOfAdDate },
              endDate: { $gte: startOfAdDate },
            },
          ],
        });

        if (isLeave || isMasterLeave) {
          throw new ApiError(
            400,
            "Doctor is on approved leave on this date. Appointments cannot be booked.",
          );
        }

        const existingActiveBooking = await (
          Appointment.findOne({
            patient: user._id,
            doctor: finalDoctorId,
            date: { $gte: startOfDay, $lte: endOfDay },
            status: {
              $in: ["pending", "confirmed", "Booked", "waiting"],
              $nin: ["cancelled", "rejected", "completed"],
            },
          }) as any
        ).unscoped();
        if (existingActiveBooking) {
          throw new ApiError(
            400,
            "Patient already has an active booking or is in the queue for this doctor today.",
          );
        }

        // 🔐 LEAVE CHECK: Block bookings if doctor is on leave
        const [onOldLeave, onMasterLeave] = await Promise.all([
          (
            Leave.findOne({
              requester: doctorProfile.user,
              status: "approved",
              startDate: { $lte: endOfDay },
              endDate: { $gte: startOfDay },
            }) as any
          ).unscoped(),
          MasterDoctorLeave.findOne({
            doctor: doctorProfile.user,
            status: "approved",
            startDate: { $lte: endOfDay },
            endDate: { $gte: startOfDay },
          }),
        ]);

        if (onOldLeave || onMasterLeave) {
          throw new ApiError(
            400,
            "Doctor is on leave today. Cannot book appointment.",
          );
        }
      }
      let appointment: any = null;
      if (finalDoctorId) {
        const hospital = await Hospital.findById(hospitalId).session(session);
        const appTypePrefix =
          visitTypeInput.toUpperCase() === "IPD"
            ? "IPD"
            : visitTypeInput.toUpperCase() === "OPD" ||
                visitTypeInput.toLowerCase() === "offline"
              ? "OPD"
              : "APT";

        const transactionId = await generateTransactionId(
          hospitalId,
          hospital?.name || "Hospital",
          appTypePrefix as any,
          session,
        );

        const finalReceiptNumber =
          receiptNumber ||
          (finalPaymentStatus === "Paid"
            ? await generateReceiptNumber(
                hospitalId,
                appTypePrefix as any,
                session,
              )
            : undefined);

        appointment = new Appointment({
          appointmentId: transactionId,
          patient: user._id,
          doctor: finalDoctorId,
          hospital: hospitalId,
          createdBy: helpdesk._id,
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
            receiptNumber: finalReceiptNumber,
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
                status: finalPaymentStatus === "Paid" ? "completed" : "pending",
                referenceId: appointment._id,
                date: new Date(),
                paymentMode: finalPaymentMethod.toLowerCase(),
                paymentDetails:
                  finalPaymentMethod.toLowerCase() === "mixed" &&
                  paymentInput.paymentDetails
                    ? {
                        cash: Number(paymentInput.paymentDetails.cash) || 0,
                        upi: Number(paymentInput.paymentDetails.upi) || 0,
                        card: Number(paymentInput.paymentDetails.card) || 0,
                      }
                    : {
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
      res.status(201).json({
        message: finalDoctorId
          ? "Patient registered successfully with appointment"
          : "Patient registered successfully",
        patient: {
          id: user._id,
          _id: user._id,
          name: user.name,
          mrn: patientProfile.mrn,
          mobile: user.mobile,
          hospitals:
            user.hospitals ||
            ((user as any).hospital ? [(user as any).hospital] : []),
        },
        visitId: appointment?._id || null,
        appointmentId: appointment?.appointmentId || null,
        credentials: {
          username: mobile,
          password: generatedPassword,
        },
      });
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

export const getPatients = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { search, q, page = 1, limit = 10, type } = req.query as any;
    const searchTerm = search || q;
    const hospitalId = new mongoose.Types.ObjectId(req.user!.hospital as any);
    const ipdAdmissions = await IPDAdmission.find({
      hospital: hospitalId,
      status: { $in: ["Active", "Discharge Initiated"] },
    }).select("patient globalPatientId");
    const admissionUserIds = new Set<string>();
    const potentialProfileIds: any[] = [];
    ipdAdmissions.forEach((adm: any) => {
      if (adm.patient) {
        const idStr = adm.patient.toString();
        if (mongoose.Types.ObjectId.isValid(idStr)) {
          admissionUserIds.add(idStr);
          potentialProfileIds.push(new mongoose.Types.ObjectId(idStr));
        }
      }
      if (adm.globalPatientId) {
        const idStr = adm.globalPatientId.toString();
        if (mongoose.Types.ObjectId.isValid(idStr)) {
          admissionUserIds.add(idStr);
        }
      }
    });
    const mappingProfiles = await PatientProfile.find({
      hospital: hospitalId,
      _id: { $in: potentialProfileIds },
    }).select("user");
    mappingProfiles.forEach((p: any) => {
      if (p.user) admissionUserIds.add(p.user.toString());
    });
    const resolvedUserIds = Array.from(admissionUserIds);
    const activePatientIdSet = admissionUserIds;

    let baseCriteria: any = {};
    if (type === "ipd") {
      baseCriteria = { _id: { $in: resolvedUserIds } };
    } else if (type === "opd") {
      baseCriteria = { hospitals: hospitalId, _id: { $nin: resolvedUserIds } };
    } else {
      baseCriteria = {
        $or: [{ hospitals: hospitalId }, { _id: { $in: resolvedUserIds } }],
      };
    }

    let query: any = {};
    if (searchTerm) {
      const profileMatches = await PatientProfile.find({
        hospital: hospitalId,
        mrn: { $regex: searchTerm, $options: "i" },
      }).select("user");
      const matchedUserIds = profileMatches.map((p) => p.user);
      const searchCriteria = {
        $or: [
          { name: { $regex: searchTerm, $options: "i" } },
          { mobile: { $regex: searchTerm, $options: "i" } },
          { _id: { $in: matchedUserIds } },
        ],
      };
      query = { $and: [baseCriteria, searchCriteria] };
    } else {
      query = baseCriteria;
    }
    const total = await Patient.countDocuments(query);
    const patients = await Patient.find(query)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .select("-password -refreshTokens")
      .sort({ createdAt: -1 });

    const patientsWithDetails = await Promise.all(
      patients.map(async (p) => {
        let profile = await PatientProfile.findOne({
          user: p._id,
          hospital: hospitalId,
        }).lean();

        // Fallback to any profile for this patient if not found in current hospital
        if (!profile) {
          profile = await (PatientProfile.findOne({ user: p._id }) as any)
            .unscoped()
            .lean();
        }

        const isIPD = activePatientIdSet.has(p._id.toString());

        // Check for active appointments/consultations for this patient
        const activeEngagement = await Appointment.findOne({
          $or: [{ patient: p._id }, { globalPatientId: p._id }],
          hospital: hospitalId,
          status: { $in: ["pending", "confirmed", "in-progress", "Booked"] },
        }).lean();

        const calculateAge = (dob: any) => {
          if (!dob) return "--";
          const birthDate = new Date(dob);
          if (isNaN(birthDate.getTime())) return "--";
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const m = today.getMonth() - birthDate.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }
          return age;
        };

        const age = calculateAge(profile?.dob || (p as any).dob);

        return {
          ...p.toObject(),
          name: sanitizePatientName(p.name),
          honorific: profile?.honorific || (p as any).honorific || "",
          mrn: (profile as any)?.mrn || (p as any).mrn || "N/A",
          mobile:
            p.mobile ||
            (profile as any)?.contactNumber ||
            (profile as any)?.mobile ||
            "--",
          age: age !== "--" ? age : "--",
          gender: (profile as any)?.gender || p.gender || "--",
          dob: profile?.dob || (p as any).dob,
          profile,
          isIPD,
          activeConsultation: !!activeEngagement,
          activeAdmission: isIPD
            ? await IPDAdmission.findOne({
                hospital: hospitalId,
                status: { $in: ["Active", "Discharge Initiated"] },
                $or: [{ patient: p._id }, { patient: (profile as any)?._id }],
              }).select("_id admissionId admissionType")
            : null,
        };
      }),
    );
    res.json({
      data: patientsWithDetails,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  },
);

export const getPatientById = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { patientId } = req.params;
    const hospitalId = req.user?.hospital;
    let user: any = null;
    let profile: any = null;
    if (mongoose.Types.ObjectId.isValid(patientId)) {
      user = await (
        Patient.findOne({
          _id: patientId,
        }) as any
      )
        .unscoped()
        .select("-password -refreshTokens");
      if (user) {
        profile = await (
          PatientProfile.findOne({
            user: user._id,
            hospital: hospitalId,
          }) as any
        ).unscoped();
        if (!profile) {
          profile = await (
            PatientProfile.findOne({ user: user._id }) as any
          ).unscoped();
        }
      } else {
        profile = await (PatientProfile.findById(patientId) as any).unscoped();
        if (profile) {
          user = await (
            Patient.findOne({
              _id: profile.user,
            }) as any
          )
            .unscoped()
            .select("-password -refreshTokens");
        }
      }
    }
    if (!user) throw new ApiError(404, "Patient not found");
    if (hospitalId && user.hospitals) {
      const isHospitalPresent = user.hospitals.some(
        (h: any) => h.toString() === hospitalId.toString(),
      );
      const hasProfile = await (
        PatientProfile.findOne({
          user: user._id,
          hospital: hospitalId,
        }) as any
      ).unscoped();
      const hasAdmission = await (
        IPDAdmission.findOne({
          hospital: hospitalId,
          $or: [{ patient: user._id }, { patient: profile?._id }],
        }) as any
      ).unscoped();
      if (!isHospitalPresent && !hasAdmission && !hasProfile) {
        throw new ApiError(
          403,
          "Patient not found or not authorized for this hospital",
        );
      }
    }
    const visitQuery: any = { patient: user._id };
    if (hospitalId) {
      visitQuery.hospital = hospitalId;
    }
    const [lastVisit, visitCount] = await Promise.all([
      Appointment.findOne(visitQuery)
        .sort({
          date: -1,
          createdAt: -1,
        })
        .populate({
          path: "doctor",
          populate: { path: "user", select: "name" },
        }),
      Appointment.countDocuments(visitQuery),
    ]);
    const activeAdmission = hospitalId
      ? await (
          IPDAdmission.findOne({
            hospital: hospitalId,
            $or: [{ patient: user._id }, { patient: profile?._id }],
            status: { $in: ["Active", "Discharge Initiated"] },
          }) as any
        )
          .unscoped()
          .select("_id admissionId status")
          .sort({ createdAt: -1 })
      : null;
    const activeConsultation = await Appointment.findOne({
      patient: user._id,
      status: "in-progress",
    })
      .select("_id status doctor startTime")
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
      });

    res.json({
      user: {
        ...user.toObject(),
        name: sanitizePatientName(user.name),
        honorific: profile?.honorific || user.honorific || "",
      },
      honorific: profile?.honorific || user.honorific || "",
      profile,
      lastVisit,
      visitCount,
      activeAdmission,
      activeConsultation,
    });
  },
);

export const lookupGuardianByMobile = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const hospitalId = req.user?.hospital;
    const { mobile } = req.query;
    if (!mobile || typeof mobile !== "string" || mobile.trim().length < 10) {
      return res
        .status(400)
        .json({ success: false, message: "Valid mobile number required" });
    }
    const cleanMobile = mobile.trim();
    const invalidValues = ["", "N/A", "n/a", "NA", "na", "null", "undefined"];

    // 1. Search recent appointments at this hospital
    const apptWithGuardian = await Appointment.findOne({
      hospital: hospitalId,
      guardianMobile: cleanMobile,
      guardianName: { $exists: true, $nin: invalidValues },
    }).sort({ createdAt: -1 });

    if (apptWithGuardian && apptWithGuardian.guardianName) {
      const gName = apptWithGuardian.guardianName.trim();
      const gRelation =
        apptWithGuardian.guardianRelation &&
        !invalidValues.includes(apptWithGuardian.guardianRelation.trim())
          ? apptWithGuardian.guardianRelation.trim()
          : "";
      const dRef =
        apptWithGuardian.doctorReference &&
        !invalidValues.includes(apptWithGuardian.doctorReference.trim())
          ? apptWithGuardian.doctorReference.trim()
          : "";

      if (!invalidValues.includes(gName)) {
        return res.json({
          success: true,
          found: true,
          guardianName: gName,
          guardianRelation: gRelation,
          guardianMobile: cleanMobile,
          doctorReference: dRef,
        });
      }
    }

    // 2. Search PatientProfiles for this hospital
    const profileWithGuardian = await PatientProfile.findOne({
      hospital: hospitalId,
      GuardianMobile: cleanMobile,
      GuardianName: { $exists: true, $nin: invalidValues },
    });

    if (profileWithGuardian && profileWithGuardian.GuardianName) {
      const gName = profileWithGuardian.GuardianName.trim();
      const gRelation =
        profileWithGuardian.GuardianRelation &&
        !invalidValues.includes(profileWithGuardian.GuardianRelation.trim())
          ? profileWithGuardian.GuardianRelation.trim()
          : "";
      const dRef =
        (profileWithGuardian as any).doctorReference &&
        !invalidValues.includes(
          (profileWithGuardian as any).doctorReference.trim(),
        )
          ? (profileWithGuardian as any).doctorReference.trim()
          : "";

      if (!invalidValues.includes(gName)) {
        return res.json({
          success: true,
          found: true,
          guardianName: gName,
          guardianRelation: gRelation,
          guardianMobile: cleanMobile,
          doctorReference: dRef,
        });
      }
    }

    return res.json({
      success: true,
      found: false,
    });
  },
);

export const updatePatient = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { patientId } = req.params;
    const hospitalId = req.user?.hospital;
    const {
      honorific,
      name,
      mobile,
      email,
      address,
      gender,
      dob,
      maritalStatus,
      bloodGroup,
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
      age,
      medicalHistory,
      allergies,
      conditions,
      medications,
      emergencyContact,
      emergencyContactName,
      emergencyContactEmail,
    } = req.body;
    const vitalsInput = req.body.vitals || {};
    let user = await (
      Patient.findOne({
        _id: patientId,
      }) as any
    ).unscoped();
    let actualPatientUserId = patientId;
    if (!user && mongoose.Types.ObjectId.isValid(patientId)) {
      const pProfile = await (
        PatientProfile.findById(patientId) as any
      ).unscoped();
      if (pProfile && pProfile.user) {
        user = await (
          Patient.findOne({
            _id: pProfile.user,
          }) as any
        ).unscoped();
        if (user) {
          actualPatientUserId = user._id;
        }
      }
    }
    if (!user) throw new ApiError(404, "Patient not found");
    if (hospitalId && user.hospitals) {
      const isHospitalPresent = user.hospitals.some(
        (h: any) => h.toString() === hospitalId.toString(),
      );
      const hasProfile = await (
        PatientProfile.findOne({
          user: user._id,
          hospital: hospitalId,
        }) as any
      ).unscoped();
      if (!isHospitalPresent && !hasProfile) {
        throw new ApiError(403, "Not authorized to update this patient");
      }
    }
    let targetDob: Date | undefined;
    let targetAge: number | undefined;

    if (dob) {
      const parsedDob = new Date(dob);
      if (!isNaN(parsedDob.getTime())) {
        if (parsedDob > new Date()) {
          throw new ApiError(400, "Date of birth cannot be in the future");
        }
        targetDob = parsedDob;
        const today = new Date();
        let calculatedYears = today.getFullYear() - parsedDob.getFullYear();
        const m = today.getMonth() - parsedDob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < parsedDob.getDate()))
          calculatedYears--;
        targetAge = Math.max(0, calculatedYears);
      }
    } else if (age !== undefined) {
      const ageNum = Number(age);
      if (!isNaN(ageNum) && ageNum >= 0 && ageNum <= 130) {
        const calculatedDob = new Date();
        calculatedDob.setFullYear(calculatedDob.getFullYear() - ageNum);
        targetDob = calculatedDob;
        targetAge = ageNum;
      }
    }

    if (name) user.name = name;
    if (mobile) user.mobile = mobile;
    if (email) user.email = email;
    if (honorific !== undefined) user.honorific = honorific;
    if (gender !== undefined) user.gender = gender;
    if (targetDob) {
      user.dateOfBirth = targetDob;
      if (targetAge !== undefined) user.age = targetAge;
    }
    await user.save();

    let profile = await (
      PatientProfile.findOne({
        user: actualPatientUserId,
        hospital: hospitalId,
      }) as any
    ).unscoped();
    if (!profile) {
      profile = new PatientProfile({
        user: actualPatientUserId,
        hospital: req.user!.hospital,
      });
    }
    if (honorific !== undefined) profile.honorific = honorific;
    if (targetDob) {
      profile.dob = targetDob;
      if (targetAge !== undefined) profile.age = targetAge;
    }
    if (emergencyContact !== undefined)
      profile.alternateNumber = emergencyContact;
    if (emergencyContactName !== undefined)
      profile.emergencyContactName = emergencyContactName;
    if (emergencyContactEmail !== undefined)
      profile.emergencyContactEmail = emergencyContactEmail;
    if (address !== undefined) profile.address = address;
    if (gender !== undefined) profile.gender = gender;
    if (maritalStatus !== undefined) profile.maritalStatus = maritalStatus;
    if (bloodGroup !== undefined) profile.bloodGroup = bloodGroup;
    if (height !== undefined) profile.height = height;
    if (weight !== undefined) profile.weight = weight;
    if (bloodPressure || bp || vitalsInput.bloodPressure || vitalsInput.bp)
      profile.bloodPressure =
        bloodPressure || bp || vitalsInput.bloodPressure || vitalsInput.bp;
    if (temperature || vitalsInput.temperature)
      profile.temperature = temperature || vitalsInput.temperature;
    if (pulse || pulseRate || vitalsInput.pulse || vitalsInput.pulseRate)
      profile.pulse =
        pulse || pulseRate || vitalsInput.pulse || vitalsInput.pulseRate;
    if (spO2 || spo2 || vitalsInput.spO2 || vitalsInput.spo2)
      profile.spO2 = spO2 || spo2 || vitalsInput.spO2 || vitalsInput.spo2;
    if (sugar || vitalsInput.sugar) profile.sugar = sugar || vitalsInput.sugar;
    if (medicalHistory !== undefined) profile.medicalHistory = medicalHistory;
    if (allergies !== undefined) profile.allergies = allergies;
    if (conditions !== undefined) profile.conditions = conditions;
    if (medications !== undefined) profile.medications = medications;
    await profile.save();
    try {
      const activeAdmission = await (
        IPDAdmission.findOne({
          $or: [{ patient: patientId }, { patient: profile._id }],
          status: "Active",
        }) as any
      ).unscoped();
      if (activeAdmission) {
        const occupancy = await BedOccupancy.findOne({
          admission: activeAdmission._id,
          endDate: { $exists: false },
        });
        if (occupancy) {
          await invalidateIPDCache(
            req.user!.hospital as any,
            occupancy.bed.toString(),
          );
        }
      }
    } catch (err) {
      console.error("Cache invalidation failed in updatePatient:", err);
    }
    res.json({ message: "Patient updated successfully", profile });
  },
);

export const deletePatient = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { patientId } = req.params;
    const hospitalId = req.user?.hospital;
    const user = await (Patient.findById(patientId) as any).unscoped();
    if (!user) throw new ApiError(404, "Patient not found");
    if (hospitalId && user.hospitals) {
      const isHospitalPresent = user.hospitals.some(
        (h: any) => h.toString() === hospitalId.toString(),
      );
      if (!isHospitalPresent) {
        throw new ApiError(403, "Not authorized to delete this patient");
      }
    }
    await (Patient.findByIdAndDelete(patientId) as any).unscoped();
    await (
      PatientProfile.findOneAndDelete({ user: patientId }) as any
    ).unscoped();
    await (Appointment.deleteMany({ patient: patientId }) as any).unscoped();
    res.json({ message: "Patient and associated records deleted permanently" });
  },
);

export const getTodayVisits = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const helpdesk = req.user as any;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    let visits = await (
      Appointment.find({
        hospital: helpdesk.hospital,
        $or: [
          { date: { $gte: startOfDay, $lte: endOfDay } },
          {
            status: { $in: ["pending", "confirmed", "in-progress", "Booked"] },
          },
        ],
      }) as any
    )
      .unscoped()
      .populate("patient", "name mobile")
      .populate("doctor", "firstName lastName")
      .sort({ date: 1, createdAt: 1 });
    visits = (visits as any[]).filter((v) => v.patient);
    res.json(visits);
  },
);

export const getPatientVisitHistory = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { patientId } = req.params;
    // 1. Resolve Identity: patientId could be User ID or Profile ID
    let user: any = null;
    let profile: any = null;

    if (mongoose.Types.ObjectId.isValid(patientId)) {
      user = await (Patient.findById(patientId) as any).unscoped().lean();
      if (user) {
        profile = await (PatientProfile.findOne({ user: user._id }) as any)
          .unscoped()
          .lean();
      } else {
        profile = await (PatientProfile.findById(patientId) as any)
          .unscoped()
          .lean();
        if (profile) {
          user = await (Patient.findById(profile.user) as any)
            .unscoped()
            .lean();
        }
      }
    }

    if (!user && !profile) {
      console.warn(
        `[getPatientVisitHistory] No patient/profile found for ID: ${patientId}`,
      );
      return res.json([]);
    }

    const userId = user?._id;
    const profileId = profile?._id;
    const patientMrn = profile?.mrn || user?.mrn;

    console.log(
      `[getPatientVisitHistory] Resolved: User=${userId} | Profile=${profileId} | MRN=${patientMrn}`,
    );

    // 2. Fetch from BOTH Appointment (Offline) and MobileAppointment (Online)
    const appointmentConditions: any[] = [];
    if (userId) {
      appointmentConditions.push({ patient: userId });
      appointmentConditions.push({ globalPatientId: userId });
    }
    if (profileId) appointmentConditions.push({ patient: profileId });
    if (patientMrn) appointmentConditions.push({ mrn: patientMrn });

    console.log(
      `[getPatientVisitHistory] Querying with conditions:`,
      JSON.stringify(appointmentConditions),
    );

    const mobileConditions: any[] = [];
    if (profileId) mobileConditions.push({ patient: profileId });
    if (userId) mobileConditions.push({ patient: userId });

    const [offlineVisits, onlineVisits] = await Promise.all([
      (
        Appointment.find({
          $or: appointmentConditions,
        }) as any
      )
        .unscoped()
        .populate({
          path: "patient",
          select: "name mobile mrn age gender",
          options: { unscoped: true },
        })
        .populate({
          path: "doctor",
          populate: { path: "user", select: "name" },
        })
        // 🗓️ Sort by updatedAt (payment is applied on update), fall back to date (scheduled)
        .sort({ updatedAt: -1, date: -1 })
        .lean(),

      mobileConditions.length > 0
        ? (
            MobileAppointment.find({
              $or: mobileConditions,
            }) as any
          )
            .unscoped()
            .populate({
              path: "doctor",
              populate: { path: "user", select: "name" },
            })
            // 🗓️ Sort by updatedAt consistently with offline visits
            .sort({ updatedAt: -1, date: -1 })
            .lean()
        : Promise.resolve([]),
    ]);

    console.log(
      `[getPatientVisitHistory] Found ${offlineVisits.length} offline and ${onlineVisits.length} online visits`,
    );

    // 3. Normalize MobileAppointments to match Appointment structure
    const normalizedOnline = onlineVisits.map((v: any) => ({
      ...v,
      type: v.mode === "online" ? "online" : "offline",
      registrationType: "OPD",
      visitType: "OPD",
      amount: v.consultationFee,
      payment: {
        amount: v.consultationFee,
        paymentStatus: v.paymentStatus,
        paymentMethod: v.paymentMethod,
        receiptNumber: v.appointmentId,
      },
      appointmentTime: v.startTime,
      doctorName: v.doctor?.user?.name || v.doctorName || "Online Doctor",
    }));

    // 4. Merge and Sort
    // 🗓️ NORMALIZED SORT: Use updatedAt (payment time) > createdAt > date (scheduled time)
    // This prevents OPD appointments with old scheduled dates from sinking below newer ones.
    const getSortDate = (v: any) =>
      new Date(v.updatedAt || v.createdAt || v.date || 0).getTime();
    const allVisits = [...offlineVisits, ...normalizedOnline].sort(
      (a, b) => getSortDate(b) - getSortDate(a),
    );

    const formattedVisits = allVisits.map((v: any) => ({
      ...v,
      patientName:
        v.patient?.name ||
        v.patientDetails?.name ||
        v.patientName ||
        profile?.user?.name ||
        "Unknown",
      doctorName: v.doctor?.user?.name || v.doctorName || "Pending Setup",
      mrn:
        v.mrn || v.patient?.mrn || v.patientDetails?.mrn || patientMrn || "N/A",
      age: v.patientDetails?.age || v.patient?.age || profile?.age || "--",
      gender:
        v.patientDetails?.gender ||
        v.patient?.gender ||
        profile?.gender ||
        "--",
      startTime: v.startTime || v.appointmentTime || v.time || "N/A",
    }));

    res.json(formattedVisits);
  },
);

export const getActiveAppointments = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const helpdesk = req.user as any;
    const activeStatuses = ["pending", "confirmed", "in-progress", "Booked"];
    let visits = await (
      Appointment.find({
        hospital: helpdesk.hospital,
        status: { $in: activeStatuses },
      }) as any
    )
      .unscoped()
      .populate("patient", "name mobile")
      .populate({ path: "doctor", populate: { path: "user", select: "name" } })
      .populate("createdBy", "name mobile")
      .sort({ date: 1 });
    visits = (visits as any[]).filter((v) => v.patient);
    res.json(visits);
  },
);

export const getAllAppointments = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const helpdesk = req.user as any;
    let visits = await (
      Appointment.find({
        hospital: helpdesk.hospital,
      }) as any
    )
      .unscoped()
      .populate("patient", "name mobile")
      .populate({ path: "doctor", populate: { path: "user", select: "name" } })
      .populate("createdBy", "name mobile")
      .sort({ date: -1 });
    visits = (visits as any[]).filter((v) => v.patient);
    res.json(visits);
  },
);

export const getPatientIPDAdmissions = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { patientId } = req.params;
    const hospitalId = req.user?.hospital;
    if (hospitalId) {
      const user = await (Patient.findById(patientId) as any).unscoped();
      if (!user) throw new ApiError(404, "Patient not found");
      const hospitalIdStr = hospitalId.toString();
      const isHospitalPresent =
        user.hospitals?.some((h: any) => h.toString() === hospitalIdStr) ||
        user.hospital?.toString() === hospitalIdStr;

      const hasProfile = await (
        PatientProfile.findOne({ user: patientId, hospital: hospitalId }) as any
      ).unscoped();

      if (!isHospitalPresent && !hasProfile) {
        throw new ApiError(
          403,
          "Not authorized to access this patient's admissions",
        );
      }
    }
    const admissions = await (
      IPDAdmission.find({
        patient: patientId,
        hospital: hospitalId,
        status: { $in: ["Active", "Discharged", "Discharge Initiated"] },
      }) as any
    )
      .unscoped()
      .populate({
        path: "primaryDoctor",
        populate: { path: "user", select: "name" },
      })
      .populate("hospital", "name address phone email")
      .populate("patient", "name email phone")
      .select(
        "admissionId admissionDate admissionType status amount paymentMethod paymentStatus vitals diet clinicalNotes symptoms reason chiefComplaint dischargeDate createdAt updatedAt",
      )
      .sort({ admissionDate: -1 })
      .lean();

    // Log for debugging field name mismatch
    console.log(
      "[getPatientIPDAdmissions] Fetched admissions:",
      admissions.map((a) => ({
        id: a.admissionId,
        reason: a.reason,
        symptoms: a.symptoms,
        chiefComplaint: a.chiefComplaint,
      })),
    );

    res.json({ admissions });
  },
);
