import { Request, Response } from "express";
import mongoose from "mongoose";
import User from "../../Auth/Models/User.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import MobileAppointment from "../../Appointment/Models/MobileAppointment.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import LabToken from "../../Lab/Models/LabToken.js";
import LabOrder from "../../Lab/Models/LabOrder.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Product from "../../Pharmacy/Models/Product.js";
import DoctorProfile from "../Models/DoctorProfile.js";
import CustomMedicine from "../Models/CustomMedicine.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import Bed from "../../IPD/Models/Bed.js";
import VitalsRecord from "../../IPD/Models/VitalsRecord.js";
import Hospital from "../../Hospital/Models/Hospital.js";

interface ConsultationRequest extends Request {
  user?: any;
}


// Helper to look up an appointment from either Appointment or MobileAppointment
async function findConsultationAppointment(appointmentId: string) {
  const isObjectId = mongoose.Types.ObjectId.isValid(appointmentId);
  let appointment: any = null;
  let isMobile = false;

  if (isObjectId) {
    appointment = await (Appointment.findById(appointmentId) as any)
      ?.unscoped()
      ?.populate({
        path: "patient",
        select: "name mobile email age ageUnit gender mrn dateOfBirth honorific",
        options: { unscoped: true },
      })
      ?.populate({
        path: "doctor",
        select: "name specialization signature medicalRegistrationNumber",
        options: { unscoped: true },
      })
      ?.populate("hospital", "name");
  }

  if (!appointment) {
    appointment = await (Appointment.findOne({ appointmentId }) as any)
      ?.unscoped()
      ?.populate({
        path: "patient",
        select: "name mobile email age ageUnit gender mrn dateOfBirth honorific",
        options: { unscoped: true },
      })
      ?.populate({
        path: "doctor",
        select: "name specialization signature medicalRegistrationNumber",
        options: { unscoped: true },
      })
      ?.populate("hospital", "name");
  }

  if (!appointment && isObjectId) {
    const mobile = await (MobileAppointment.findById(appointmentId) as any)
      ?.unscoped()
      ?.populate({
        path: "patient",
        options: { unscoped: true },
        populate: { path: "user", options: { unscoped: true }, select: "name mobile email age gender mrn dateOfBirth honorific" },
      })
      ?.populate({
        path: "doctor",
        options: { unscoped: true },
        select: "name specialization signature medicalRegistrationNumber",
        populate: { path: "user", options: { unscoped: true }, select: "name" },
      })
      ?.populate("hospital", "name");

    if (mobile) {
      appointment = mobile;
      isMobile = true;
    }
  }

  if (!appointment) {
    const mobile = await (MobileAppointment.findOne({ appointmentId }) as any)
      ?.unscoped()
      ?.populate({
        path: "patient",
        options: { unscoped: true },
        populate: { path: "user", options: { unscoped: true }, select: "name mobile email age gender mrn dateOfBirth honorific" },
      })
      ?.populate({
        path: "doctor",
        options: { unscoped: true },
        select: "name specialization signature medicalRegistrationNumber",
        populate: { path: "user", options: { unscoped: true }, select: "name" },
      })
      ?.populate("hospital", "name");

    if (mobile) {
      appointment = mobile;
      isMobile = true;
    }
  }

  return { appointment, isMobile };
}

// Start consultation
export const startConsultation = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;

    const { appointment, isMobile } = await findConsultationAppointment(appointmentId);

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (appointment.status === "completed" || appointment.status === "Completed") {
      return res.json({
        success: true,
        message: "Consultation already completed",
        appointment,
      });
    }

    // If it's already in-progress, ensure the start time is set
    const currentStatus = (appointment.status || "").toLowerCase();
    if (currentStatus !== "in-progress") {
      appointment.status = isMobile ? "In-Progress" : "in-progress";
      appointment.queue_status = "CURRENT";
      appointment.called_time = new Date();
      appointment.isPaused = false;
      appointment.consultationStartTime =
        appointment.consultationStartTime || new Date();
      await appointment.save();

      // Notify helpdesk via WebSocket
      try {
        const { getIO } = await import("../../config/socket.js");
        const io = (req as any).io || getIO();
        const hospId = appointment.hospital?._id || appointment.hospital;
        if (io && hospId) {
          const hospitalRoom = `hospital_${hospId}`;
          io.to(hospitalRoom).emit("dashboard:update", {
            message: "Consultation started",
            appointmentId: appointment._id,
          });
        }
      } catch (wsErr) {
        console.warn("WebSocket notification error:", wsErr);
      }
    } else if (!appointment.consultationStartTime) {
      appointment.consultationStartTime = new Date();
      appointment.isPaused = false;
      await appointment.save();
    }

    // Safely emit queue update to TV handler and patient sockets
    try {
      const { emitQueueUpdate } = await import("../../config/tvSocketHandler.js");
      const { getIO } = await import("../../config/socket.js");
      const io = (req as any).io || getIO();
      if (io) {
        const docId = appointment.doctor?._id || appointment.doctor;
        const hospId = appointment.hospital?._id || appointment.hospital;
        await emitQueueUpdate(io, docId, hospId);

        const patientUserId = (appointment.patient as any)?.user?._id || (appointment.patient as any)?._id || appointment.patient;
        if (patientUserId) {
          io.to(`patient_${patientUserId}`).emit("consultation_started", {
            appointmentId: appointment._id,
            doctorId: docId,
            status: "in-progress"
          });
          io.to(`patient_${patientUserId}`).emit("appointment:status_change", {
            appointmentId: appointment._id,
            status: "in-progress"
          });
        }

        if (hospId) {
          io.to(`hospital_${hospId}`).emit("appointment_status_changed", {
            appointmentId: appointment._id,
            status: "in-progress"
          });
          io.to(`hospital_${hospId}`).emit("consultation_started", {
            appointmentId: appointment._id,
            doctorId: docId,
            status: "in-progress"
          });
          io.to(`hospital_${hospId}`).emit("dashboard:update", { hospitalId: hospId });
        }

        // Broadcast to general channels
        io.emit("queue_update", { doctorId: docId, hospitalId: hospId });
        io.emit("consultation_started", { appointmentId: appointment._id, doctorId: docId, status: "in-progress" });
        io.emit("appointment_status_changed", { appointmentId: appointment._id, status: "in-progress" });
        io.emit("appointment:status_change", { appointmentId: appointment._id, status: "in-progress" });
        io.emit("dashboard:update", { hospitalId: hospId });
      }
    } catch (tvErr) {
      console.warn("TV socket handler update skipped/failed:", tvErr);
    }

    // Enrich with patient profile data
    let profile: any = null;
    try {
      const patientId = (appointment.patient as any)?.user?._id || (appointment.patient as any)?._id || appointment.patient;
      if (patientId) {
        profile = await PatientProfile.findOne({ user: patientId });
        if (!profile && mongoose.connection.db) {
          const rawProfile = await mongoose.connection.db
            .collection("patientprofiles")
            .findOne({ user: new mongoose.Types.ObjectId(patientId) });
          profile = rawProfile as any;
        }
      }
      if (!profile && (appointment.patient as any)?.user) {
        profile = appointment.patient;
      }
    } catch (profErr) {
      console.warn("Error fetching patient profile:", profErr);
    }

    const patientData: any = appointment.patient ? JSON.parse(JSON.stringify(appointment.patient)) : {};
    if (patientData.user && typeof patientData.user === "object") {
      patientData._id = patientData.user._id || patientData._id;
      patientData.name = patientData.user.name || patientData.name;
      patientData.mobile = patientData.user.mobile || patientData.mobile;
      patientData.email = patientData.user.email || patientData.email;
    }

    if (profile) {
      patientData.age = appointment.patientDetails?.age || profile.age || patientData.age;
      patientData.ageUnit = (appointment.patient as any)?.ageUnit || appointment.patientDetails?.ageUnit || (profile as any)?.ageUnit || patientData.ageUnit || "Years";
      patientData.gender = appointment.patientDetails?.gender || profile.gender || patientData.gender;
      patientData.mrn = appointment.mrn || profile.mrn || patientData.mrn || "N/A";

      patientData.honorific = (appointment as any).appointmentHonorific || (appointment as any).honorific || appointment.patientDetails?.honorific || profile.honorific || patientData.honorific || "";
      patientData.address = profile.address || "N/A";
      patientData.bloodGroup = profile.bloodGroup || "N/A";
      patientData.allergies = profile.allergies;
      patientData.medicalHistory = profile.medicalHistory;
      patientData.emergencyContact = profile.alternateNumber;
      patientData.contactNumber = profile.contactNumber;
      patientData.dob = profile.dob || patientData.dateOfBirth;
    } else {
      patientData.ageUnit = (appointment.patient as any)?.ageUnit || appointment.patientDetails?.ageUnit || patientData.ageUnit || "Years";
      patientData.honorific = (appointment as any).appointmentHonorific || (appointment as any).honorific || appointment.patientDetails?.honorific || patientData.honorific || "";
      patientData.dob = patientData.dateOfBirth || appointment.patientDetails?.dob;
    }

    const rawApptVitals = appointment.vitals
      ? JSON.parse(JSON.stringify(appointment.vitals))
      : {};

    const mergedVitals = {
      bloodPressure:
        rawApptVitals.bloodPressure ||
        rawApptVitals.bp ||
        profile?.bloodPressure ||
        "",
      temperature:
        rawApptVitals.temperature ||
        rawApptVitals.temp ||
        profile?.temperature ||
        "",
      pulse: rawApptVitals.pulse || profile?.pulse || "",
      spO2: rawApptVitals.spO2 || rawApptVitals.spo2 || profile?.spO2 || "",
      height: rawApptVitals.height || profile?.height || "",
      weight: rawApptVitals.weight || profile?.weight || "",
      glucose: rawApptVitals.glucose || profile?.glucose || "",
    };

    const finalNotes =
      appointment.reason ||
      (appointment as any).notes ||
      (appointment.symptoms && appointment.symptoms.length > 0
        ? appointment.symptoms[0]
        : "");

    // Fetch IPD Status safely if patient is admitted
    let ipdDetails: any = null;
    try {
      const patientId = (appointment.patient as any)?._id || appointment.patient;
      if (patientId) {
        const activeAdmission = await IPDAdmission.findOne({
          patient: { $in: [patientId, profile?._id].filter(Boolean) },
          status: "Active",
        }).populate({
          path: "primaryDoctor",
          populate: { path: "user", select: "name" },
        });

        if (activeAdmission) {
          let bedDetails: any = null;
          try {
            const occupancy = await (
              BedOccupancy.findOne({
                admission: activeAdmission._id,
                endDate: { $exists: false },
              }) as any
            )?.unscoped();

            if (occupancy && occupancy.bed) {
              bedDetails = await (
                Bed.findById(occupancy.bed).lean() as any
              )?.unscoped();
            }
          } catch (bedErr) {
            console.warn("Error fetching bed details:", bedErr);
          }

          let latestVitalsRecord: any = null;
          try {
            latestVitalsRecord = await (
              VitalsRecord.findOne({
                admission: activeAdmission._id,
              }) as any
            )
              ?.unscoped()
              ?.sort({ timestamp: -1 })
              ?.lean();
          } catch (vitalsErr) {
            console.warn("Error fetching latest vitals record:", vitalsErr);
          }

          ipdDetails = {
            admissionId: activeAdmission.admissionId,
            admittedDate: activeAdmission.admissionDate,
            primaryDoctor:
              (activeAdmission.primaryDoctor as any)?.user?.name || "N/A",
            bed: bedDetails || null,
            latestVitals: latestVitalsRecord || null,
            status: activeAdmission.status,
          };
        }
      }
    } catch (ipdErr) {
      console.warn("Error checking IPD admission:", ipdErr);
    }

    // Fetch Lab Results for this appointment safely
    let labResults: any = [];
    try {
      const labTokens = await (
        LabToken.find({ appointment: appointmentId }) as any
      )?.unscoped();
      if (labTokens && labTokens.length > 0) {
        const tokenNumbers = labTokens.map((t: any) => t.tokenNumber);
        labResults = await (
          LabOrder.find({
            tokenNumber: { $in: tokenNumbers },
            doctorNotified: true,
          }) as any
        )
          ?.unscoped()
          ?.populate({
            path: "tests.test",
            select: "testName name",
            options: { unscoped: true },
          })
          ?.sort({ createdAt: -1 })
          ?.limit(1)
          ?.lean();
      }
    } catch (labErr) {
      console.warn("Error fetching lab results:", labErr);
    }

    res.json({
      success: true,
      appointment: {
        _id: appointment._id,
        patient: patientData,
        doctor: appointment.doctor,
        hospital: appointment.hospital,
        date: appointment.date,
        startTime: appointment.startTime,
        appointmentTime: appointment.appointmentTime,
        type: appointment.type,
        status: appointment.status,
        reason: finalNotes,
        notes: finalNotes,
        symptoms: appointment.symptoms,
        vitals: mergedVitals,
        mrn: patientData.mrn,
        consultationStartTime: appointment.consultationStartTime || new Date(),
        isPaused: !!appointment.isPaused,
        pausedDuration: appointment.pausedDuration || 0,
        ipdDetails: ipdDetails,
        labResults: labResults,
        prescription: appointment.prescription,
        labToken: appointment.labToken,
      },
    });
  } catch (error: any) {
    console.error("Start consultation error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Save consultation draft
export const saveConsultationDraft = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;
    const { diagnosis, clinicalNotes, plan } = req.body;

    let appointment = await (Appointment.findById(appointmentId) as any)?.unscoped();
    if (!appointment) {
      appointment = await (MobileAppointment.findById(appointmentId) as any)?.unscoped();
    }
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (diagnosis !== undefined) appointment.diagnosis = diagnosis;
    if (clinicalNotes !== undefined) appointment.clinicalNotes = clinicalNotes;
    if (plan !== undefined) appointment.plan = plan;

    await appointment.save();

    res.json({
      success: true,
      message: "Draft saved successfully",
      appointment,
    });
  } catch (error: any) {
    console.error("Save consultation draft error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// End consultation
export const endConsultation = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;
    const { duration, diagnosis, clinicalNotes, plan } = req.body;
    const isObjectId = mongoose.Types.ObjectId.isValid(appointmentId);

    let appointment = isObjectId
      ? await (Appointment.findById(appointmentId) as any)?.unscoped()
      : null;
    if (!appointment) {
      appointment = await (Appointment.findOne({ appointmentId }) as any)?.unscoped();
    }
    let isMobile = false;
    if (!appointment && isObjectId) {
      appointment = await (MobileAppointment.findById(appointmentId) as any)?.unscoped();
      if (appointment) isMobile = true;
    }
    if (!appointment) {
      appointment = await (MobileAppointment.findOne({ appointmentId }) as any)?.unscoped();
      if (appointment) isMobile = true;
    }
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // Update appointment
    appointment.status = isMobile ? "Completed" : "completed";
    appointment.queue_status = "COMPLETED";
    appointment.isPaused = false;
    appointment.consultationEndTime = new Date();
    appointment.consultationDuration = duration || 0;
    if (diagnosis) appointment.diagnosis = diagnosis;
    if (clinicalNotes) appointment.clinicalNotes = clinicalNotes;
    if (plan) appointment.plan = plan;

    await appointment.save();

    const { emitQueueUpdate } = await import("../../config/tvSocketHandler.js");
    const { getIO } = await import("../../config/socket.js");
    const io = (req as any).io || getIO();
    const docId = appointment.doctor?._id || appointment.doctor;
    const hospId = appointment.hospital?._id || appointment.hospital;

    if (io) {
      await emitQueueUpdate(io, docId, hospId);
    }

    // Emit Socket Event for Dashboard & Patient Update
    let populatedAppt: any = null;
    if (isMobile) {
      populatedAppt = await (MobileAppointment.findById(appointment._id) as any)
        ?.unscoped()
        ?.populate({
          path: "doctor",
          options: { unscoped: true },
          populate: { path: "user", options: { unscoped: true } },
        })
        ?.populate("hospital")
        ?.populate({
          path: "patient",
          options: { unscoped: true },
          populate: { path: "user", options: { unscoped: true } },
        });
    } else {
      populatedAppt = await (Appointment.findById(appointment._id) as any)
        ?.unscoped()
        ?.populate({
          path: "doctor",
          options: { unscoped: true },
          populate: { path: "user", options: { unscoped: true } },
        })
        ?.populate("hospital")
        ?.populate("patient");
    }

    if (io) {
      const patientUserId = (populatedAppt?.patient as any)?.user?._id || (populatedAppt?.patient as any)?._id || (appointment.patient as any)?._id || appointment.patient;
      const doctorUserId = (populatedAppt?.doctor as any)?.user?._id;
      const targetHospitalId = populatedAppt?.hospital?._id || populatedAppt?.hospital || hospId;

      if (doctorUserId) {
        io.to(`doctor_${doctorUserId}`).emit("dashboard:update", {
          message: "Consultation completed",
          appointmentId: appointment._id,
        });
      }

      if (targetHospitalId) {
        const hospitalRoom = `hospital_${targetHospitalId}`;
        io.to(hospitalRoom).emit("dashboard:update", {
          message: "Consultation completed",
          appointmentId: appointment._id,
        });
      }

      if (patientUserId) {
        io.to(`patient_${patientUserId}`).emit("appointment_completed", {
          appointmentId: appointment._id,
          status: "completed",
        });
        io.to(`patient_${patientUserId}`).emit("appointment:status_change", {
          appointmentId: appointment._id,
          status: "completed",
        });
        io.to(`user_${patientUserId}`).emit("appointment_completed", {
          appointmentId: appointment._id,
          status: "completed",
        });
      }

      io.emit("appointment_status_changed", {
        appointmentId: appointment._id,
        status: "completed",
        doctorId: docId,
        hospitalId: targetHospitalId,
      });
    }

    // Fetch prescriptions and lab tokens for this appointment
    const prescriptions = await Prescription.find({
      appointment: appointmentId,
    });
    const labTokens = await LabToken.find({ appointment: appointmentId });

    res.json({
      success: true,
      appointment,
      prescriptions,
      labTokens,
      message: "Consultation completed successfully",
    });
  } catch (error: any) {
    console.error("End consultation error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get consultation summary
export const getConsultationSummary = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;

    const { appointment, isMobile } = await findConsultationAppointment(appointmentId);

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // Enrich with patient profile data
    // 🔧 FIX: Robust lookup for cross-branch patient data
    let profile = await PatientProfile.findOne({
      user: (appointment.patient as any)?._id,
    });

    if (!profile) {
      const rawProfile = await mongoose.connection.db
        ?.collection("patientprofiles")
        .findOne({
          user: new mongoose.Types.ObjectId((appointment.patient as any)?._id),
        });
      profile = rawProfile as any;
    }

    const patientData: any = JSON.parse(JSON.stringify(appointment.patient));

    if (profile) {
      patientData.age = appointment.patientDetails?.age || profile.age || patientData.age;
      patientData.ageUnit = (appointment.patient as any)?.ageUnit || appointment.patientDetails?.ageUnit || (profile as any)?.ageUnit || patientData.ageUnit || "Years";
      patientData.gender = appointment.patientDetails?.gender || profile.gender || patientData.gender;
      patientData.mrn = appointment.mrn || profile.mrn || "N/A";

      // Comprehensive Data Mapping
      patientData.honorific = (appointment as any).appointmentHonorific || (appointment as any).honorific || appointment.patientDetails?.honorific || profile.honorific || patientData.honorific || "";
      patientData.address = profile.address || "N/A";
      patientData.bloodGroup = profile.bloodGroup || "N/A";
      patientData.allergies = profile.allergies;
      patientData.medicalHistory = profile.medicalHistory;
      patientData.emergencyContact = profile.alternateNumber;
      patientData.contactNumber = profile.contactNumber;
      patientData.dob = profile.dob || patientData.dateOfBirth;
    } else {
      patientData.ageUnit = (appointment.patient as any)?.ageUnit || appointment.patientDetails?.ageUnit || patientData.ageUnit || "Years";
      patientData.honorific = (appointment as any).appointmentHonorific || (appointment as any).honorific || appointment.patientDetails?.honorific || patientData.honorific || "";
      patientData.dob = patientData.dateOfBirth || appointment.patientDetails?.dob;
    }

    // Per-field Merge of Vitals (Appointment > Profile > Empty)
    const rawApptVitals = appointment.vitals
      ? JSON.parse(JSON.stringify(appointment.vitals))
      : {};

    const mergedVitals = {
      bloodPressure:
        rawApptVitals.bloodPressure ||
        rawApptVitals.bp ||
        profile?.bloodPressure ||
        "",
      temperature:
        rawApptVitals.temperature ||
        rawApptVitals.temp ||
        profile?.temperature ||
        "",
      pulse: rawApptVitals.pulse || profile?.pulse || "",
      spO2: rawApptVitals.spO2 || rawApptVitals.spo2 || profile?.spO2 || "",
      height: rawApptVitals.height || profile?.height || "",
      weight: rawApptVitals.weight || profile?.weight || "",
      glucose:
        rawApptVitals.glucose ||
        rawApptVitals.sugar ||
        profile?.glucose ||
        profile?.sugar ||
        "",
    };

    const finalNotes =
      appointment.reason ||
      (appointment as any).notes ||
      (appointment.symptoms && appointment.symptoms.length > 0
        ? appointment.symptoms[0]
        : "");

    // Fetch IPD Status for Summary (Crucial for page refresh sustainability)
    const activeAdmission = await IPDAdmission.findOne({
      patient: { $in: [(appointment.patient as any)._id, profile?._id] },
      status: "Active",
    }).populate({
      path: "primaryDoctor",
      populate: { path: "user", select: "name" },
    });

    let ipdDetails: any = null;
    if (activeAdmission) {
      const occupancy = await BedOccupancy.findOne({
        admission: activeAdmission._id,
        endDate: { $exists: false },
      });

      let bedDetails: any = null;
      if (occupancy && occupancy.bed) {
        bedDetails = await Bed.findById(occupancy.bed).lean();
      }

      const latestVitalsRecord = await VitalsRecord.findOne({
        admission: activeAdmission._id,
      })
        .sort({ timestamp: -1 })
        .lean();

      ipdDetails = {
        admissionId: activeAdmission.admissionId,
        admittedDate: activeAdmission.admissionDate,
        primaryDoctor:
          (activeAdmission.primaryDoctor as any)?.user?.name || "N/A",
        bed: bedDetails || null,
        latestVitals: latestVitalsRecord || null,
        status: activeAdmission.status,
      };
    }

    const enrichedAppointment = {
      ...appointment.toObject(),
      patient: patientData,
      vitals: mergedVitals,
      reason: finalNotes,
      notes: finalNotes,
      ipdDetails: ipdDetails,
    };

    const prescriptions = await (
      Prescription.find({
        appointment: appointmentId,
      }) as any
    )
      .unscoped()
      .populate({
        path: "doctor",
        select: "name signature medicalRegistrationNumber",
        options: { unscoped: true },
      });

    const labTokens = await (
      LabToken.find({
        appointment: appointmentId,
      }) as any
    )
      .unscoped()
      .populate({
        path: "doctor",
        select: "name signature medicalRegistrationNumber",
        options: { unscoped: true },
      });

    const tokenNumbers = labTokens.map((t) => t.tokenNumber);
    const labResults = await LabOrder.find({
      tokenNumber: { $in: tokenNumbers },
      doctorNotified: true,
    })
      .populate("tests.test", "testName name")
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();

    res.json({
      success: true,
      appointment: enrichedAppointment,
      prescriptions,
      labTokens,
      labResults,
    });
  } catch (error: any) {
    console.error("Get consultation summary error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Send documents to helpdesk
export const sendToHelpdesk = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const { appointmentId, cloudinaryDocumentUrl, cloudinaryLabTokenUrl } =
      req.body;

    const appointment = await Appointment.findById(appointmentId)
      .populate("patient", "name mrn")
      .populate("doctor", "name");

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    appointment.sentToHelpdesk = true;
    appointment.sentToHelpdeskAt = new Date();
    if (cloudinaryDocumentUrl)
      appointment.cloudinaryDocumentUrl = cloudinaryDocumentUrl;
    if (cloudinaryLabTokenUrl)
      appointment.cloudinaryLabTokenUrl = cloudinaryLabTokenUrl;

    await appointment.save();

    // Notify helpdesk via WebSocket
    const io = (req as any).io;
    if (io) {
      const hospitalRoom = `hospital_${appointment.hospital}`;
      io.to(hospitalRoom).emit("new_transit", {
        appointmentId: appointment._id,
        patientName: (appointment.patient as any)?.name,
        patientMRN: (appointment.patient as any)?.mrn,
        message: "New clinical documents available for collection",
      });
    }

    res.json({
      success: true,
      message: "Documents sent to helpdesk successfully",
    });
  } catch (error: any) {
    console.error("Send to helpdesk error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Search medicines from Pharmacy Inventory AND Custom Non-Pharmacy Catalog
export const searchMedicines = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const { query } = req.query;
    if (!query || typeof query !== "string") {
      return res.json({ success: true, data: [] });
    }

    const doctorId = req.user?._id;
    const doctor = await (
      DoctorProfile.findOne({ user: doctorId }) as any
    )?.unscoped();

    const hospitalId = doctor?.hospital || (req as any).hospitalId || (req as any).tenantId || req.user?.hospital || (req.query?.hospitalId as string);

    // 1. Search Pharmacy Inventory (Product)
    const productFilter: any = {
      isActive: true,
      $or: [
        { name: { $regex: query, $options: "i" } },
        { generic: { $regex: query, $options: "i" } },
        { brand: { $regex: query, $options: "i" } },
      ],
    };
    if (hospitalId) {
      productFilter.hospital = hospitalId;
    }

    const products = await (Product.find(productFilter) as any)
      ?.unscoped()
      ?.limit(20)
      ?.select("name brand generic strength form stock mrp unitsPerPack")
      ?.lean() || [];

    const pharmacyResults = products.map((p: any) => ({
      ...p,
      isPharmacyStock: true,
    }));

    // 2. Search Custom / Non-Pharmacy Auto-Learned Catalog (CustomMedicine)
    let customResults: any[] = [];
    try {
      const customFilter: any = {
        $or: [
          { name: { $regex: query, $options: "i" } },
          { generic: { $regex: query, $options: "i" } },
          { brand: { $regex: query, $options: "i" } },
        ],
      };
      if (hospitalId) {
        customFilter.hospital = hospitalId;
      }

      const customMeds = await CustomMedicine.find(customFilter)
        .limit(20)
        .sort({ timesPrescribed: -1, lastUsedAt: -1 })
        .lean() || [];

      customResults = customMeds.map((c: any) => ({
        _id: c._id,
        name: c.name,
        brand: c.brand || c.name,
        generic: c.generic || "",
        form: c.form || "Tablet",
        dosage: c.dosage || "",
        stock: 0,
        isPharmacyStock: false,
      }));
    } catch (cErr) {
      console.warn("[SearchMedicines] CustomMedicine lookup warning:", cErr);
    }

    // Deduplicate by name (prefer pharmacy stock if duplicate)
    const pharmacyNames = new Set(
      pharmacyResults.map((p: any) => (p.name || "").toLowerCase().trim())
    );
    const filteredCustomResults = customResults.filter(
      (c: any) => !pharmacyNames.has((c.name || "").toLowerCase().trim())
    );

    const mergedData = [...pharmacyResults, ...filteredCustomResults];

    res.json({
      success: true,
      data: mergedData,
    });
  } catch (error: any) {
    console.error("Search medicines error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Pause consultation
export const pauseConsultation = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;
    const { pauseReason } = req.body;
    const isObjectId = mongoose.Types.ObjectId.isValid(appointmentId);

    let appointment = isObjectId
      ? await (Appointment.findById(appointmentId) as any)?.unscoped()
      : null;
    if (!appointment) {
      appointment = await (Appointment.findOne({ appointmentId }) as any)?.unscoped();
    }
    let isMobile = false;
    if (!appointment && isObjectId) {
      appointment = await (MobileAppointment.findById(appointmentId) as any)?.unscoped();
      if (appointment) isMobile = true;
    }
    if (!appointment) {
      appointment = await (MobileAppointment.findOne({ appointmentId }) as any)?.unscoped();
      if (appointment) isMobile = true;
    }
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (!["in-progress", "In-Progress"].includes(appointment.status)) {
      return res
        .status(400)
        .json({ message: "Only in-progress consultations can be paused" });
    }

    // Mark as paused
    appointment.isPaused = true;
    appointment.pausedAt = new Date();
    appointment.queue_status = "PAUSED";
    await appointment.save();

    const { emitQueueUpdate } = await import("../../config/tvSocketHandler.js");
    const { getIO } = await import("../../config/socket.js");
    const io = (req as any).io || getIO();
    const docId = appointment.doctor?._id || appointment.doctor;
    const hospId = appointment.hospital?._id || appointment.hospital;

    if (io) {
      await emitQueueUpdate(io, docId, hospId);
      const patientUserId = (appointment.patient as any)?.user?._id || (appointment.patient as any)?.user || (appointment.patient as any)?._id || appointment.patient;
      if (patientUserId) {
        io.to(`patient_${patientUserId}`).emit("consultation_paused", {
          appointmentId: appointment._id,
          doctorId: docId,
          isPaused: true,
          status: "paused",
        });
        io.to(`patient_${patientUserId}`).emit("appointment:status_change", {
          appointmentId: appointment._id,
          status: "paused",
          isPaused: true,
        });
      }
      io.emit("consultation_paused", {
        appointmentId: appointment._id,
        doctorId: docId,
        isPaused: true,
      });
      if (hospId) {
        io.to(`hospital_${hospId}`).emit("dashboard:update", {
          message: "Consultation paused",
          appointmentId: appointment._id,
        });
      }
    }

    res.json({
      success: true,
      message: "Consultation paused successfully",
      appointment,
    });
  } catch (error: any) {
    console.error("Pause consultation error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Resume consultation
export const resumeConsultation = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;
    const isObjectId = mongoose.Types.ObjectId.isValid(appointmentId);

    let appointment = isObjectId
      ? await (Appointment.findById(appointmentId) as any)?.unscoped()
      : null;
    if (!appointment) {
      appointment = await (Appointment.findOne({ appointmentId }) as any)?.unscoped();
    }
    let isMobile = false;
    if (!appointment && isObjectId) {
      appointment = await (MobileAppointment.findById(appointmentId) as any)?.unscoped();
      if (appointment) isMobile = true;
    }
    if (!appointment) {
      appointment = await (MobileAppointment.findOne({ appointmentId }) as any)?.unscoped();
      if (appointment) isMobile = true;
    }
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (!appointment.isPaused) {
      return res.status(400).json({ message: "Appointment is not paused" });
    }

    // Calculate the paused duration and add to total
    if (appointment.pausedAt) {
      const pausedDuration = Math.floor(
        (Date.now() - new Date(appointment.pausedAt).getTime()) / 1000,
      );
      appointment.pausedDuration =
        (appointment.pausedDuration || 0) + pausedDuration;
    }

    // Resume consultation
    appointment.isPaused = false;
    appointment.pausedAt = null;
    appointment.resumedAt = new Date();
    appointment.queue_status = "CURRENT";
    await appointment.save();

    const { emitQueueUpdate } = await import("../../config/tvSocketHandler.js");
    const { getIO } = await import("../../config/socket.js");
    const io = (req as any).io || getIO();
    const docId = appointment.doctor?._id || appointment.doctor;
    const hospId = appointment.hospital?._id || appointment.hospital;

    if (io) {
      await emitQueueUpdate(io, docId, hospId);
      const patientUserId = (appointment.patient as any)?.user?._id || (appointment.patient as any)?.user || (appointment.patient as any)?._id || appointment.patient;
      if (patientUserId) {
        io.to(`patient_${patientUserId}`).emit("consultation_resumed", {
          appointmentId: appointment._id,
          doctorId: docId,
          isPaused: false,
          status: "in-progress",
        });
        io.to(`patient_${patientUserId}`).emit("appointment:status_change", {
          appointmentId: appointment._id,
          status: "in-progress",
          isPaused: false,
        });
      }
      io.emit("consultation_resumed", {
        appointmentId: appointment._id,
        doctorId: docId,
        isPaused: false,
      });
      if (hospId) {
        io.to(`hospital_${hospId}`).emit("dashboard:update", {
          message: "Consultation resumed",
          appointmentId: appointment._id,
        });
      }
    }

    res.json({
      success: true,
      message: "Consultation resumed successfully",
      appointment,
    });
  } catch (error: any) {
    console.error("Resume consultation error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all paused appointments for current doctor
export const getPausedAppointments = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const userId = req.user?._id;

    // Find doctor profile
    const doctorProfile = await (
      DoctorProfile.findOne({ user: userId }) as any
    ).unscoped();
    if (!doctorProfile) {
      return res.status(404).json({ message: "Doctor profile not found" });
    }

    // Get all paused appointments for this doctor across both Appointment and MobileAppointment
    const [regularPaused, mobilePaused] = await Promise.all([
      Appointment.find({
        doctor: doctorProfile._id,
        isPaused: true,
        status: { $in: ["in-progress", "In-Progress"] },
      })
        .populate("patient", "name mobile email age gender mrn")
        .populate("hospital", "name")
        .sort({ pausedAt: -1 })
        .lean(),
      (MobileAppointment.find({
        doctor: doctorProfile._id,
        isPaused: true,
        status: { $in: ["in-progress", "In-Progress"] },
      }) as any)
        .unscoped()
        .populate({
          path: "patient",
          options: { unscoped: true },
          populate: { path: "user", options: { unscoped: true }, select: "name mobile email age gender mrn" }
        })
        .populate("hospital", "name")
        .sort({ pausedAt: -1 })
        .lean(),
    ]);

    const normalizedMobilePaused = (mobilePaused || []).map((m: any) => ({
      ...m,
      patient: {
        _id: m.patient?.user?._id || m.patient?.user || m.patient?._id,
        name: m.patient?.user?.name || m.patient?.name || "Patient",
        mobile: m.patient?.user?.mobile || m.patient?.mobile || "N/A",
        email: m.patient?.user?.email || m.patient?.email || "",
        age: m.patient?.user?.age || m.patient?.age,
        gender: m.patient?.user?.gender || m.patient?.gender,
        mrn: m.mrn || m.patient?.mrn || "N/A",
      },
      isMobile: true,
    }));

    const enrichedAppointments = await Promise.all(
      [...(regularPaused || []), ...normalizedMobilePaused].map(async (appointment: any) => {
        let patientData: any = JSON.parse(
          JSON.stringify(appointment.patient || {}),
        );
        const patientUserId = patientData._id;
        if (patientUserId) {
          const profile = await (
            PatientProfile.findOne({
              user: patientUserId,
            }) as any
          )?.unscoped();

          if (profile) {
            patientData.mrn = appointment.mrn || profile.mrn || patientData.mrn || "N/A";
            patientData.age = appointment.patientDetails?.age || profile.age || patientData.age;
            patientData.gender =
              appointment.patientDetails?.gender || profile.gender || patientData.gender;
          }
        }

        return {
          ...appointment,
          patient: patientData,
        };
      }),
    );

    res.json({
      success: true,
      appointments: enrichedAppointments,
    });
  } catch (error: any) {
    console.error("Get paused appointments error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete appointment
export const deleteAppointment = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;

    let appointment = await (
      Appointment.findByIdAndDelete(appointmentId) as any
    )?.unscoped();
    if (!appointment) {
      appointment = await (
        MobileAppointment.findByIdAndDelete(appointmentId) as any
      )?.unscoped();
    }
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    res.json({
      success: true,
      message: "Appointment deleted successfully",
    });
  } catch (error: any) {
    console.error("Delete appointment error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get Lab Results for Doctor
export const getLabResults = async (
  req: ConsultationRequest,
  res: Response,
) => {
  try {
    const userId = req.user?._id;
    const { status, patientId, limit = 20, page = 1 } = req.query;

    console.log("🔍 Fetching lab results for doctor user:", userId);

    // 1. Find the Doctor Profile to get the profile ID
    const profile = await (
      DoctorProfile.findOne({ user: userId }) as any
    ).unscoped();

    // 2. Search IDs to check: both User ID and Profile ID
    const searchIds = [userId];
    if (profile) {
      console.log("✅ Found associated Profile ID:", profile._id);
      searchIds.push(profile._id);
    }

    // Build flexible query - Show all stages so doctor can track progress
    const query: any = {
      doctor: { $in: searchIds },
      status: {
        $in: ["prescribed", "sample_collected", "processing", "completed"],
      },
    };

    if (status) {
      query.status = status;
    }

    if (patientId) {
      query.patient = patientId;
    }

    // ONLY SHOW RESULTS IF TECHNICIAN HAS EXPLICITLY NOTIFIED DOCTOR
    query.doctorNotified = true;

    console.log("🔍 Executing query:", JSON.stringify(query));

    // Diagnostic count
    const total = await LabOrder.countDocuments(query);
    console.log(
      `📊 Found ${total} matching results for doctor IDs: ${searchIds.join(", ")}`,
    );

    const skip = (Number(page) - 1) * Number(limit);

    const labResults = await (LabOrder.find(query) as any)
      .unscoped()
      .populate({
        path: "patient",
        select: "name mobile email mrn",
        options: { unscoped: true },
      })
      .populate({
        path: "doctor",
        select: "name email",
        options: { unscoped: true },
      })
      .populate({
        path: "referredBy",
        select: "name email",
        options: { unscoped: true },
      })
      .populate("hospital", "name")
      .populate({
        path: "tests.test",
        select: "testName name price",
        options: { unscoped: true },
      })
      .sort({ completedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    // 3. Fetch Patient Profiles to get official MRNs if missing from user
    const patientIds = labResults
      .map((r: any) => r.patient?._id)
      .filter((id) => id);
    const profiles = await (
      mongoose
        .model("PatientProfile")
        .find({ user: { $in: patientIds } }) as any
    )
      .unscoped()
      .select("user mrn")
      .lean();
    const profileMap = new Map(
      profiles.map((p: any) => [p.user.toString(), p.mrn]),
    );

    // 4. Robust Doctor Name Fetching
    // Sometimes orders might store Profile ID instead of User ID
    const doctorIds = labResults
      .map((r: any) => r.doctor?._id || r.doctor)
      .filter(
        (id) =>
          (id && typeof id === "string") ||
          id instanceof mongoose.Types.ObjectId,
      );
    const doctorUserIds = labResults
      .map((r: any) => r.doctor?._id)
      .filter((id) => id);

    // Find any potentially unpopulated doctors (where ID might be a Profile ID)
    const unpopulatedDoctorIds = labResults
      .filter((r: any) => !r.doctor?.name)
      .map((r: any) => r.doctor?._id || r.doctor);

    let extraDoctorMap = new Map();
    if (unpopulatedDoctorIds.length > 0) {
      // Check if these are DoctorProfile IDs
      const drProfiles = await (
        mongoose
          .model("DoctorProfile")
          .find({ _id: { $in: unpopulatedDoctorIds } }) as any
      )
        .unscoped()
        .populate({ path: "user", select: "name", options: { unscoped: true } })
        .lean();
      drProfiles.forEach((p: any) => {
        if (p.user?.name) extraDoctorMap.set(p._id.toString(), p.user.name);
      });

      // Also check if these are User IDs that just weren't populated for some reason
      const drUsers = await (
        mongoose
          .model("User")
          .find({ _id: { $in: unpopulatedDoctorIds } }) as any
      )
        .unscoped()
        .select("name")
        .lean();
      drUsers.forEach((u: any) => {
        extraDoctorMap.set(u._id.toString(), u.name);
      });
    }

    // Transform results for frontend
    const transformedResults = labResults.map((order: any) => {
      const rawDoctorId =
        order.doctor?._id?.toString() || order.doctor?.toString();
      const doctorNameFallback =
        extraDoctorMap.get(rawDoctorId) ||
        (profile && rawDoctorId === profile._id.toString()
          ? (req as any).user?.name
          : null);

      return {
        _id: order._id,
        sampleId:
          (order as any).sampleId ||
          order.tokenNumber ||
          order._id.toString().slice(-6),
        patient: {
          ...(order.patient || {}),
          mrn:
            order.patient?.mrn ||
            profileMap.get(order.patient?._id?.toString()) ||
            `MRN-${order._id.toString().slice(-6)}`,
        },
        doctor: {
          _id: rawDoctorId,
          name:
            order.referredBy?.name ||
            order.doctor?.name ||
            doctorNameFallback ||
            (req as any).user?.name ||
            "Assigned Physician",
        },
        hospital: order.hospital,
        status: order.status,
        doctorNotified: order.doctorNotified,
        createdAt: order.createdAt,
        completedAt: order.completedAt,
        tests: order.tests.map((t: any) => ({
          testName:
            t.testName || t.test?.testName || t.test?.name || "Unknown Test",
          testId: t.test?._id || t.test,
          status: t.status,
          result: t.result,
          isAbnormal: t.isAbnormal,
          remarks: t.remarks,
          subTests: (t.subTests || []).map((s: any) => ({
            name: s.name,
            result: s.result,
            unit: s.unit,
            range: s.range,
          })),
        })),
      };
    });

    res.json({
      success: true,
      data: transformedResults,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error: any) {
    console.error("Get lab results error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
