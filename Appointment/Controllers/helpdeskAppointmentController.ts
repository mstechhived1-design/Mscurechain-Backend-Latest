import { Request, Response } from "express";
import Appointment from "../Models/Appointment.js";
import Patient from "../../Patient/Models/Patient.js";
import User from "../../Auth/Models/User.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import MobileAppointment from "../Models/MobileAppointment.js";
import mongoose from "mongoose";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import { AppointmentRequest } from "../types/index.js";

// ─── MASTER HELPDESK: GLOBAL APPOINTMENT OVERVIEW ───────────────────────────
/**
 * Master Helpdesk Ledger: Unified view across all models and hospitals
 */
export const getMasterHelpdeskAppointments = asyncHandler(
  async (req: Request, res: Response) => {
    const appsReq = req as unknown as AppointmentRequest;
    try {
      const { role, _id } = appsReq.user!;
      console.log(`[MasterHelpdesk] Global Overview Request - User: ${_id}`);

      let query: any = {};
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;
      const sortOrder: 1 | -1 = req.query.sort === "oldest" ? 1 : -1;
      const searchQuery = req.query.search as string;
      const channel = req.query.channel as string; // 'online' (mobile) or 'offline' (manual)

      // Master Helpdesk can filter by any hospital provided in query, or see all
      if (
        req.query.hospitalId &&
        mongoose.Types.ObjectId.isValid(req.query.hospitalId as string)
      ) {
        query.hospital = new mongoose.Types.ObjectId(
          req.query.hospitalId as string,
        );
      }

      if (
        req.query.doctorId &&
        mongoose.Types.ObjectId.isValid(req.query.doctorId as string)
      ) {
        query.doctor = new mongoose.Types.ObjectId(
          req.query.doctorId as string,
        );
      }

      if (searchQuery) {
        let matchingPatients = await (
          Patient.find({
            $or: [
              { name: { $regex: searchQuery, $options: "i" } },
              { mobile: { $regex: searchQuery, $options: "i" } },
            ],
          }) as any
        )
          .unscoped()
          .select("_id");

        const patientIds = matchingPatients.map((p: any) => p._id);
        query.$or = [
          { mrn: { $regex: searchQuery, $options: "i" } },
          { patient: { $in: patientIds } },
          { "patientDetails.name": { $regex: searchQuery, $options: "i" } },
          { appointmentId: { $regex: searchQuery, $options: "i" } },
        ];
      }

      if (req.query.date || req.query.startDate || req.query.endDate) {
        const start = new Date((req.query.date || req.query.startDate) as string);
        start.setHours(0, 0, 0, 0);
        const end = new Date((req.query.date || req.query.endDate) as string);
        end.setHours(23, 59, 59, 999);
        query.date = { $gte: start, $lte: end };
      }

      // 1. Fetch Records from both collections
      console.log("[MasterHelpdesk] Query:", JSON.stringify(query));
      console.log(
        "[MasterHelpdesk] Channel:",
        channel,
        "Hospital:",
        req.query.hospitalId,
      );
      const fetchApps = async () => {
        const rawApps = await (Appointment.find(query) as any)
          .unscoped()
          .sort({ date: sortOrder, createdAt: sortOrder })
          .skip(skip)
          .limit(limit)
          .lean();

        const Hospital = (await import("../../Hospital/Models/Hospital.js"))
          .default;
        const PatientModel = (await import("../../Patient/Models/Patient.js"))
          .default;
        const PatientProfileModel = (
          await import("../../Patient/Models/PatientProfile.js")
        ).default;

        const appsWithPatientData = await Promise.all(
          rawApps.map(async (app: any) => {
            const patientId =
              app.patient?._id || app.patient || app.globalPatientId;
            const hospitalId = app.hospital;

            let patientDoc: any = null;
            let profileDoc: any = null;

            if (patientId) {
              // 1. Fetch Name/Mobile from patients collection (unscoped to bypass hospital isolation)
              patientDoc = await (PatientModel.findById(patientId) as any)
                .unscoped()
                .lean();

              // 2. Fetch MRN from patientprofiles (hospital-specific)
              if (hospitalId) {
                profileDoc = await (
                  PatientProfileModel.findOne({
                    user: patientId,
                    hospital: hospitalId,
                  }) as any
                )
                  .unscoped()
                  .lean();
              }

              // 3. Fallback to any profile for this patient if hospital-specific not found (vital for cross-hospital visits)
              if (!profileDoc) {
                profileDoc = await (
                  PatientProfileModel.findOne({ user: patientId }) as any
                )
                  .unscoped()
                  .lean();
              }
            }

            // Case: If patient still unknown, check if patientId was actually a Profile ID
            if (!patientDoc && patientId) {
              const potentialProfile = await (
                PatientProfileModel.findById(patientId) as any
              )
                .unscoped()
                .lean();
              if (potentialProfile) {
                profileDoc = potentialProfile;
                patientDoc = await (
                  PatientModel.findById(potentialProfile.user) as any
                )
                  .unscoped()
                  .lean();
              }
            }

            const hospitalDoc = hospitalId
              ? await (Hospital.findById(hospitalId) as any).lean()
              : null;
            let doctorDoc: any = null;
            if (app.doctor) {
              const DoctorProfile = (
                await import("../../Doctor/Models/DoctorProfile.js")
              ).default;
              doctorDoc = await (DoctorProfile.findById(app.doctor) as any)
                .unscoped()
                .populate("user", "name")
                .lean();
            }

            // Robust field resolution
            const placeholders = [
              "unknown",
              "unnamed",
              "patient",
              "debug",
              "test",
              "n/a",
              "",
            ];
            let pName = "Unknown Patient";

            if (
              patientDoc?.name &&
              !placeholders.includes(patientDoc.name.toLowerCase().trim())
            ) {
              pName = patientDoc.name;
            } else if (
              app.patientDetails?.name &&
              !placeholders.includes(
                app.patientDetails.name.toLowerCase().trim(),
              )
            ) {
              pName = app.patientDetails.name;
            } else if (
              app.patientName &&
              !placeholders.includes(app.patientName.toLowerCase().trim())
            ) {
              pName = app.patientName;
            } else if (patientDoc?.name) {
              pName = patientDoc.name; // Fallback to whatever is in the doc if nothing else found
            } else if (app.name) {
              pName = app.name;
            }

            const pMobile =
              patientDoc?.mobile ||
              app.patientDetails?.mobile ||
              app.patientMobile ||
              app.mobile ||
              "N/A";
            const pMrn =
              profileDoc?.mrn || app.mrn || app.patientDetails?.mrn || "N/A";

            // Calculate age if not directly available
            let pAge =
              profileDoc?.age ||
              patientDoc?.age ||
              app.patientDetails?.age ||
              "--";
            if (pAge === "--" && patientDoc?.dob) {
              pAge = Math.floor(
                (Date.now() - new Date(patientDoc.dob).getTime()) /
                  (365.25 * 24 * 60 * 60 * 1000),
              );
            }

            const pGender =
              profileDoc?.gender ||
              patientDoc?.gender ||
              app.patientDetails?.gender ||
              "--";

            return {
              ...app,
              patientName: pName,
              mrn: pMrn,
              patientMobile: pMobile,
              age: pAge,
              gender: pGender,
              patient: {
                _id: patientDoc?._id || profileDoc?.user || patientId,
                name: pName,
                mobile: pMobile,
                email: patientDoc?.email,
                mrn: pMrn,
                age: pAge,
                gender: pGender,
              },
              patientprofile: {
                mrn: pMrn,
                age: pAge,
                gender: pGender,
              },
              doctorName:
                doctorDoc?.user?.name ||
                doctorDoc?.name ||
                app.doctorName ||
                "Pending Setup",
              doctor: doctorDoc
                ? {
                    _id: doctorDoc._id,
                    user: doctorDoc.user,
                    name: doctorDoc.user?.name,
                  }
                : app.doctor,
              hospital: hospitalDoc
                ? { _id: hospitalDoc._id, name: hospitalDoc.name }
                : app.hospital,
            };
          }),
        );

        return appsWithPatientData;
      };

      const fetchMobile = async () => {
        console.log("[MasterHelpdesk] fetchMobile called");
        const result = await (MobileAppointment.find(query) as any)
          .unscoped()
          .sort({ date: sortOrder, createdAt: sortOrder })
          .skip(skip)
          .limit(limit)
          .populate({
            path: "patient",
            select: "name mrn dob gender user",
            populate: {
              path: "user",
              select: "name mobile email",
              options: { unscoped: true },
            },
            options: { unscoped: true },
          })
          .populate("hospital", "name")
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          })
          .lean();
        console.log(
          "[MasterHelpdesk] MobileApps result sample:",
          result[0]?._id,
          "patient field:",
          result[0]?.patient,
        );
        return result;
      };

      let apps: any[] = [];
      let mobileApps: any[] = [];

      if (channel === "online") {
        mobileApps = await fetchMobile();
      } else if (channel === "offline") {
        apps = await fetchApps();
      } else {
        // Fetch from both by default
        const results = await Promise.all([fetchApps(), fetchMobile()]);
        apps = results[0];
        mobileApps = results[1];
      }

      console.log(
        "[MasterHelpdesk] Apps fetched:",
        apps.length,
        "MobileApps:",
        mobileApps.length,
      );

      // 2. Normalization & Combination
      const combined: any[] = [
        ...apps,
        ...mobileApps.map((m) => ({ ...m, isOnline: true })),
      ].sort((a: any, b: any) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return sortOrder === 1 ? dateA - dateB : dateB - dateA;
      });

      console.log("[MasterHelpdesk] Combined array length:", combined.length);
      // Log first few items in combined to see what we're processing
      if (combined.length > 0) {
        console.log("[MasterHelpdesk] First item in combined:", {
          _id: combined[0]._id,
          isOnline: combined[0].isOnline,
          patient: combined[0].patient,
          patients: combined[0].patients,
          mrn: combined[0].mrn,
        });
      }

      let total = 0;
      let onlineCount = 0;
      let offlineCount = 0;

      // Always fetch counts for all channels to populate filter buttons
      const [allOffline, allOnline] = await Promise.all([
        Appointment.countDocuments(query),
        MobileAppointment.countDocuments(query),
      ]);
      onlineCount = allOnline;
      offlineCount = allOffline;

      if (channel === "online") {
        total = onlineCount;
      } else if (channel === "offline") {
        total = offlineCount;
      } else {
        total = onlineCount + offlineCount;
      }

      // 3. High-Fidelity Demographic Mapping
      const enriched = combined.slice(0, limit).map((app: any) => {
        // Unified demographic resolution
        const placeholders = [
          "unknown",
          "unnamed",
          "patient",
          "debug",
          "test",
          "n/a",
          "",
        ];
        let pName = app.patientName || "Unknown Patient";

        if (
          app.patientName &&
          !placeholders.includes(app.patientName.toLowerCase().trim())
        ) {
          pName = app.patientName;
        } else if (
          app.patient?.name &&
          !placeholders.includes(app.patient.name.toLowerCase().trim())
        ) {
          pName = app.patient.name;
        } else if (
          app.patient?.user?.name &&
          !placeholders.includes(app.patient.user.name.toLowerCase().trim())
        ) {
          pName = app.patient.user.name;
        } else if (
          app.patients?.name &&
          !placeholders.includes(app.patients.name.toLowerCase().trim())
        ) {
          pName = app.patients.name;
        } else if (
          app.patientDetails?.name &&
          !placeholders.includes(app.patientDetails.name.toLowerCase().trim())
        ) {
          pName = app.patientDetails.name;
        }

        const pMobile =
          app.patientMobile ||
          app.mobile ||
          app.patient?.user?.mobile ||
          app.patients?.mobile ||
          "N/A";
        const mrn =
          app.mrn ||
          app.patientprofile?.mrn ||
          app.patient?.mrn ||
          app.patient?.profile?.mrn ||
          "N/A";

        // Age/Gender with fallback calculation
        let age =
          app.age && app.age !== "--"
            ? app.age
            : app.patientprofile?.age || app.patient?.age || "--";
        if (age === "--" && app.patient?.user?.dob) {
          age = Math.floor(
            (Date.now() - new Date(app.patient.user.dob).getTime()) /
              (365.25 * 24 * 60 * 60 * 1000),
          );
        }
        const gender =
          app.gender && app.gender !== "--"
            ? app.gender
            : app.patientprofile?.gender || app.patient?.gender || "--";

        return {
          ...app,
          id: app._id,
          patientName: pName,
          mrn,
          patientMobile: pMobile,
          age,
          gender,
          patient: {
            _id:
              app.patient?.user?._id ||
              app.patient?.user ||
              app.patient?._id ||
              app.patients?._id ||
              (typeof app.patient === "string" ||
              mongoose.Types.ObjectId.isValid(app.patient)
                ? app.patient
                : null),
            name: pName,
            mobile: pMobile,
            mrn: mrn,
            age: age,
            gender: gender,
          },
          patientprofile: {
            mrn,
            age,
            gender,
          },
          doctorName:
            app.doctorName ||
            app.doctor?.user?.name ||
            (app.doctor as any)?.name ||
            "Pending Assignment",
          hospital: app.hospital?.name || app.hospitalName || "N/A",
        };
      });

      res.json({
        success: true,
        data: enriched,
        pagination: {
          total,
          onlineCount,
          offlineCount,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err: any) {
      console.error("[MasterHelpdesk] Error:", err);
      res.status(500).json({
        success: false,
        message: "Master Ledger Error",
        error: err.message,
      });
    }
  },
);

// ─── LOCAL HELPDESK: HOSPITAL-SPECIFIC APPOINTMENT LIST ─────────────────────
export const getHelpdeskAppointments = asyncHandler(
  async (req: Request, res: Response) => {
    const appsReq = req as unknown as AppointmentRequest;
    try {
      const hospitalId =
        (appsReq as any).hospitalId || (appsReq.user as any).hospital;
      if (!hospitalId)
        return res.status(400).json({ message: "No hospital context found" });

      console.log(`[Helpdesk] Local Desk Request - Hospital: ${hospitalId}`);

      let query: any = { hospital: new mongoose.Types.ObjectId(hospitalId) };
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;
      const sortOrder: 1 | -1 = req.query.sort === "oldest" ? 1 : -1;
      const channel = req.query.channel as string;

      if (req.query.search) {
        const s = req.query.search as string;
        query.$or = [
          { mrn: { $regex: s, $options: "i" } },
          { "patientDetails.name": { $regex: s, $options: "i" } },
          { appointmentId: { $regex: s, $options: "i" } },
        ];
      }

      if (
        req.query.doctorId &&
        mongoose.Types.ObjectId.isValid(req.query.doctorId as string)
      ) {
        query.doctor = new mongoose.Types.ObjectId(
          req.query.doctorId as string,
        );
      }

      if (req.query.date || req.query.startDate || req.query.endDate) {
        const start = new Date((req.query.date || req.query.startDate) as string);
        start.setHours(0, 0, 0, 0);
        const end = new Date((req.query.date || req.query.endDate) as string);
        end.setHours(23, 59, 59, 999);
        query.date = { $gte: start, $lte: end };
      }

      // Fetch Local Records
      console.log("[Helpdesk] HospitalId:", hospitalId);
      let apps: any[] = [];
      let mobileApps: any[] = [];

      if (channel === "online") {
        // Mobile Appointment linkage for local hospital
        const mobileProfileIds = await (
          PatientProfile.find({ hospital: hospitalId }) as any
        )
          .unscoped()
          .select("_id")
          .lean();
        const mobQuery = {
          ...query,
          patient: { $in: mobileProfileIds.map((p: any) => p._id) },
        };
        mobileApps = await (MobileAppointment.find(mobQuery) as any)
          .unscoped()
          .sort({ date: sortOrder, createdAt: sortOrder })
          .skip(skip)
          .limit(limit)
          .populate({ path: "patient", populate: { path: "user" } })
          .lean();
      } else if (channel === "offline") {
        apps = await (Appointment.find(query) as any)
          .unscoped()
          .sort({ date: sortOrder, createdAt: sortOrder })
          .skip(skip)
          .limit(limit)
          .populate({
            path: "patient",
            select: "name mobile email mrn age gender",
            options: { unscoped: true },
          })
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          })
          .lean();
      } else {
        // Default: Fetch Both
        const mobileProfileIds = await (
          PatientProfile.find({ hospital: hospitalId }) as any
        )
          .unscoped()
          .select("_id")
          .lean();
        const mobQuery = {
          ...query,
          patient: { $in: mobileProfileIds.map((p: any) => p._id) },
        };

        const results = await Promise.all([
          (Appointment.find(query) as any)
            .unscoped()
            .sort({ date: sortOrder, createdAt: sortOrder })
            .skip(skip)
            .limit(limit)
            .populate({
              path: "patient",
              select: "name mobile email mrn age gender",
              options: { unscoped: true },
            })
            .populate({
              path: "doctor",
              populate: { path: "user", select: "name" },
            })
            .lean(),
          (MobileAppointment.find(mobQuery) as any)
            .unscoped()
            .sort({ date: sortOrder, createdAt: sortOrder })
            .skip(skip)
            .limit(limit)
            .populate({ path: "patient", populate: { path: "user" } })
            .lean(),
        ]);
        apps = results[0];
        mobileApps = results[1];
      }

      const combined: any[] = [
        ...apps,
        ...mobileApps.map((m) => ({ ...m, isOnline: true })),
      ].sort((a: any, b: any) =>
        sortOrder === 1
          ? new Date(a.date).getTime() - new Date(b.date).getTime()
          : new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      let total = 0;
      let onlineCount = 0;
      let offlineCount = 0;

      // Local stats check
      const [allOffline, allOnline] = await Promise.all([
        Appointment.countDocuments(query),
        MobileAppointment.countDocuments({
          ...query,
          patient: { $exists: true },
        }),
      ]);
      onlineCount = allOnline;
      offlineCount = allOffline;

      if (channel === "online") {
        total = onlineCount;
      } else if (channel === "offline") {
        total = offlineCount;
      } else {
        total = onlineCount + offlineCount;
      }

      const enriched = await Promise.all(
        combined.slice(0, limit).map(async (app: any) => {
          let pName = "Unknown Patient";
          let pMobile = "N/A";
          let mrn = "N/A";
          let age = "--";
          let gender = "--";
          let pId = null;

          const PatientModel = (await import("../../Patient/Models/Patient.js"))
            .default;
          const PatientProfileModel = (
            await import("../../Patient/Models/PatientProfile.js")
          ).default;

          let patientDoc = app.patient || app.patients;
          let profileDoc: any = null;

          if (app.isOnline) {
            // Online: patient field is PatientProfile
            profileDoc = app.patient || app.patients;
            pId = profileDoc?.user?._id || profileDoc?.user;
            patientDoc = profileDoc?.user;

            if (pId && (typeof patientDoc === "string" || !patientDoc?.name)) {
              patientDoc = await (PatientModel.findById(pId) as any)
                .unscoped()
                .lean();
            }
          } else {
            // Offline: patient field is Patient document (ObjectId or Object)
            pId = patientDoc?._id || patientDoc;

            if (pId && (typeof patientDoc === "string" || !patientDoc?.name)) {
              patientDoc = await (PatientModel.findById(pId) as any)
                .unscoped()
                .lean();
            }

            if (pId) {
              profileDoc = await (
                PatientProfileModel.findOne({
                  user: pId,
                  hospital: hospitalId,
                }) as any
              )
                .unscoped()
                .lean();
              if (!profileDoc)
                profileDoc = await (
                  PatientProfileModel.findOne({ user: pId }) as any
                )
                  .unscoped()
                  .lean();
            }
          }

          const placeholders = [
            "unknown",
            "unnamed",
            "patient",
            "debug",
            "test",
            "n/a",
            "",
          ];
          pName = "Unknown Patient";

          if (
            patientDoc?.name &&
            !placeholders.includes(patientDoc.name.toLowerCase().trim())
          ) {
            pName = patientDoc.name;
          } else if (
            app.patientDetails?.name &&
            !placeholders.includes(app.patientDetails.name.toLowerCase().trim())
          ) {
            pName = app.patientDetails.name;
          } else if (
            app.patientName &&
            !placeholders.includes(app.patientName.toLowerCase().trim())
          ) {
            pName = app.patientName;
          } else if (patientDoc?.name) {
            pName = patientDoc.name;
          }

          pMobile =
            patientDoc?.mobile ||
            app.patientDetails?.mobile ||
            app.patientMobile ||
            "N/A";
          mrn = profileDoc?.mrn || app.mrn || "N/A";
          age =
            profileDoc?.age ||
            patientDoc?.age ||
            app.patientDetails?.age ||
            "--";
          gender =
            profileDoc?.gender ||
            patientDoc?.gender ||
            app.patientDetails?.gender ||
            "--";

          if (age === "--" && (profileDoc?.dob || patientDoc?.dob)) {
            const dob = profileDoc?.dob || patientDoc?.dob;
            const diff = Date.now() - new Date(dob).getTime();
            age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000)).toString();
          }

          return {
            ...app,
            id: app._id,
            patientName: pName,
            mrn,
            mobile: pMobile,
            patientMobile: pMobile,
            age,
            gender,
            patient: {
              _id: pId,
              name: pName,
              mobile: pMobile,
              mrn: mrn,
              age: age,
              gender: gender,
            },
            patientprofile: {
              mrn,
              age,
              gender,
            },
            doctorName:
              app.doctorName ||
              app.doctor?.user?.name ||
              (app.doctor as any)?.name ||
              "Pending Assignment",
          };
        }),
      );

      res.json({
        success: true,
        data: enriched,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err: any) {
      console.error("[Helpdesk] Error:", err);
      res.status(500).json({
        success: false,
        message: "Helpdesk Ledger Error",
        error: err.message,
      });
    }
  },
);
