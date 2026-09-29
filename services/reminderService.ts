import Prescription from "../Prescription/Models/Prescription.js";
import { createNotification } from "../Notification/Controllers/notificationController.js";
import User from "../Auth/Models/User.js";
import DoctorProfile from "../Doctor/Models/DoctorProfile.js";
import StaffProfile from "../Staff/Models/StaffProfile.js";
import Notification from "../Notification/Models/Notification.js";
import IPDAdmission from "../IPD/Models/IPDAdmission.js";
import VitalsThreshold from "../IPD/Models/VitalsThreshold.js";
import VitalsAlert from "../IPD/Models/VitalsAlert.js";
import DischargeRecord from "../Discharge/Models/DischargeRecord.js";
import mongoose from "mongoose";
import ReminderConfiguration from "../Hospital/Models/ReminderConfiguration.js";
import PatientProfile from "../Patient/Models/PatientProfile.js";

/**
 * Service to process follow-up reminders
 * Now updated to use hospital-specific dynamic slots with fallback support
 */
export const processFollowUpReminders = async () => {
  try {
    const now = new Date();

    // 1. Fetch available custom configurations
    const configs = await (
      ReminderConfiguration.find({ isActive: true }) as any
    ).unscoped();

    // Process hospitals WITH configurations
    for (const config of configs) {
      await processHospitalOpdReminders(
        config.hospital,
        config.opdReminderSlots,
        now,
      );
    }

    // 2. Identify hospitals with active prescriptions but NO configuration
    const hospitalsWithPrescriptions = await (
      Prescription.distinct("hospital", {
        followUpDate: { $gte: new Date() },
      }) as any
    ).unscoped();

    const configHospitalIds = configs.map((c) => c.hospital.toString());
    const hospitalsWithoutConfig = hospitalsWithPrescriptions.filter(
      (id) => id && !configHospitalIds.includes(id.toString()),
    );

    // 3. Process hospitals WITHOUT custom config (using defaults)
    const defaultOpdSlots = [
      { hour: 8, minute: 0 },
      { hour: 13, minute: 0 },
      { hour: 16, minute: 20 },
      { hour: 19, minute: 0 },
    ];

    for (const hospitalId of hospitalsWithoutConfig) {
      await processHospitalOpdReminders(hospitalId, defaultOpdSlots, now);
    }
  } catch (err) {
    console.error("[ReminderService] Error processing OPD reminders:", err);
  }
};

/**
 * Helper to get day difference (Target - Now)
 */
function getDaysDiff(futureDate: Date, now: Date) {
  const f = new Date(futureDate);
  const n = new Date(now);
  f.setHours(0, 0, 0, 0);
  n.setHours(0, 0, 0, 0);
  return Math.round((f.getTime() - n.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Helper to get current slot index based on time
 */
function getCurrentSlotIndex(slots: any[], now: Date) {
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  let currentSlotIndex = -1;
  const sortedSlots = [...slots].sort(
    (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute),
  );

  for (let i = sortedSlots.length - 1; i >= 0; i--) {
    const slotTime = sortedSlots[i].hour * 60 + sortedSlots[i].minute;
    if (currentHour * 60 + currentMin >= slotTime) {
      currentSlotIndex = i;
      break;
    }
  }
  return { currentSlotIndex, sortedSlots };
}

/**
 * Helper to process OPD reminders for a specific hospital and set of slots
 */
async function processHospitalOpdReminders(
  hospitalId: any,
  slots: any[],
  now: Date,
) {
  const { currentSlotIndex, sortedSlots } = getCurrentSlotIndex(slots, now);
  if (currentSlotIndex === -1) return;

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const prescriptions = await (
    Prescription.find({
      hospital: hospitalId,
      followUpDate: { $gte: startOfToday },
      $or: [
        { followUpRemindersSent: { $lt: sortedSlots.length } },
        { followUpRemindersSent: { $exists: false } },
      ],
    }) as any
  )
    .unscoped()
    .populate({ path: "patient", select: "name", options: { unscoped: true } });

  console.log(
    `[ReminderService] Hospital ${hospitalId}: Found ${prescriptions.length} potential prescriptions matching base criteria.`,
  );

  // Extract all unique doctor IDs for bulk lookup
  const doctorIds = Array.from(
    new Set(prescriptions.map((p: any) => p.doctor).filter((id) => id)),
  );
  const doctorProfiles = await (
    DoctorProfile.find({
      _id: { $in: doctorIds },
    }) as any
  )
    .unscoped()
    .lean();
  const docProfileMap = new Map(
    doctorProfiles.map((p) => [p._id.toString(), p]),
  );

  const userIds = Array.from(
    new Set(doctorProfiles.map((p) => p.user).filter((id) => id)),
  );
  const users = await (User.find({ _id: { $in: userIds } }) as any)
    .unscoped()
    .lean();
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  // Process all prescriptions in parallel to avoid blocking the loop
  await Promise.all(
    prescriptions.map(async (prescription) => {
      if (!prescription.followUpDate) return;

      const daysDiff = getDaysDiff(prescription.followUpDate, now);
      const currentlySent = (prescription as any).followUpRemindersSent || 0;

      if (daysDiff !== 1) return; // Only tomorrow for OPD
      if (currentlySent > currentSlotIndex) return;

      let senderId =
        (prescription as any).createdBy || (prescription as any).doctor;
      let doctorName = "your doctor";

      const docProfile: any = (prescription as any).doctor
        ? docProfileMap.get((prescription as any).doctor.toString())
        : null;
      if (docProfile?.user) {
        senderId = docProfile.user;
        const docUser: any = userMap.get(docProfile.user.toString());
        if (docUser) doctorName = docUser.name;
      }

      const followUpDateStr = new Date(
        prescription.followUpDate,
      ).toLocaleDateString();

      // Create notifications for all missed slots up to currentSlotIndex
      const notificationPromises: Promise<any>[] = [];
      for (
        let slotIdx = currentlySent;
        slotIdx <= currentSlotIndex;
        slotIdx++
      ) {
        const patientName = (prescription.patient as any)?.name || "you";
        const message = `Follow-up Reminder for ${patientName}: You have a scheduled visit tomorrow (${followUpDateStr}) for "${(prescription as any).diagnosis}". Please consult with Dr. ${doctorName}.`;

        notificationPromises.push(
          createNotification(null, {
            hospital: hospitalId,
            recipient: prescription.patient,
            sender: senderId,
            type: "followup_reminder",
            message,
            relatedId: prescription._id,
          }),
        );
      }

      await Promise.all(notificationPromises);
      (prescription as any).followUpRemindersSent = currentSlotIndex + 1;
      await prescription.save();
    }),
  );
}

/**
 * Service to process Discharge Follow-up Reminders (IPD)
 * Now dynamic based on Hospital settings and follows configured slots
 */
export const processDischargeFollowUpReminders = async () => {
  try {
    const now = new Date();
    const configs = await (
      ReminderConfiguration.find({ isActive: true }) as any
    ).unscoped();

    for (const config of configs) {
      const hospitalId = config.hospital;
      const reminderDays = (config.ipdReminderDays || [1]).sort(
        (a, b) => b - a,
      ); // e.g. [2, 1]
      const slots = config.opdReminderSlots || [
        { hour: 8, minute: 0 },
        { hour: 13, minute: 0 },
        { hour: 20, minute: 0 },
      ];

      const { currentSlotIndex, sortedSlots } = getCurrentSlotIndex(slots, now);
      console.log(
        `[ReminderService] Checking Hospital: ${hospitalId}, Current Slot Index: ${currentSlotIndex}, Target Days: ${reminderDays}`,
      );

      if (currentSlotIndex === -1) {
        console.log(
          `[ReminderService] No active slot for current time ${now.getHours()}:${now.getMinutes()}`,
        );
        continue;
      }

      const totalProjectedReminders = reminderDays.length * sortedSlots.length;
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);

      const dischargeRecords = await (
        DischargeRecord.find({
          hospital: hospitalId,
          status: "completed",
          followUpDate: { $gte: startOfToday },
          $or: [
            { followUpRemindersSent: { $lt: totalProjectedReminders } },
            { followUpRemindersSent: { $exists: false } },
          ],
        }) as any
      ).unscoped();

      console.log(
        `[ReminderService] Hospital ${hospitalId}: Found ${dischargeRecords.length} potential records matching base criteria.`,
      );

      // Extra optimization: Fetch all patient profiles in bulk
      const mrns = Array.from(
        new Set(dischargeRecords.map((r) => r.mrn).filter((mrn) => mrn)),
      );
      const profiles = await (
        PatientProfile.find({ mrn: { $in: mrns } }) as any
      )
        .unscoped()
        .lean();
      const profileMap = new Map(profiles.map((p) => [p.mrn, p]));

      // Fetch potential doctor users for sender resolution
      const doctorNames = Array.from(
        new Set(
          dischargeRecords
            .map((r) => (r as any).primaryDoctor)
            .filter((d) => d),
        ),
      );
      const doctorUsers = await (
        User.find({
          hospital: hospitalId,
          name: { $in: doctorNames },
          role: "doctor",
        }) as any
      )
        .unscoped()
        .select("_id name")
        .lean();
      const doctorUserMap = new Map(doctorUsers.map((u) => [u.name, u._id]));

      await Promise.all(
        dischargeRecords.map(async (record) => {
          if (!record.followUpDate || !record.mrn) return;

          const daysDiff = getDaysDiff(record.followUpDate, now);
          const dayIndex = reminderDays.indexOf(daysDiff);

          if (dayIndex === -1) return;

          const targetRemindersSent =
            dayIndex * sortedSlots.length + currentSlotIndex + 1;
          const currentlySent = (record as any).followUpRemindersSent || 0;

          if (currentlySent < targetRemindersSent) {
            const profile: any = profileMap.get(record.mrn);

            if (profile?.user) {
              const followUpDateStr = new Date(
                record.followUpDate,
              ).toLocaleDateString();
              const timeStr = new Date(record.followUpDate).toLocaleTimeString(
                [],
                { hour: "2-digit", minute: "2-digit" },
              );

              let senderId = (record as any).createdBy;
              if ((record as any).primaryDoctor) {
                const docId = doctorUserMap.get((record as any).primaryDoctor);
                if (docId) senderId = docId;
              }

              const patientName = profile?.name || "you";
              const message = `Upcoming Follow-up for ${patientName}: You have a check-up scheduled on ${followUpDateStr} at ${timeStr === "12:00 AM" ? "hospital" : timeStr}. (${daysDiff === 1 ? "Tomorrow" : daysDiff + " days to go"})`;

              await createNotification(null, {
                hospital: hospitalId,
                recipient: profile.user as any,
                sender: senderId,
                type: "followup_reminder",
                message,
                relatedId: record._id,
              });

              (record as any).followUpRemindersSent = targetRemindersSent;
              await record.save();
            }
          }
        }),
      );
    }
  } catch (err) {
    console.error(
      "[ReminderService] Error processing discharge reminders:",
      err,
    );
  }
};

/**
 * Service to process Vitals Monitoring Escalation
 * Rule: Escalate if a patient with Abnormal/Critical vitals isn't re-monitored within interval.
 * Critical: Hourly | Warning: Shiftly (Admin Configurable)
 */
export const processVitalsMonitoringEscalation = async () => {
  try {
    console.log(
      "[ReminderService] Running Vitals Monitoring Escalation Checks...",
    );

    // 1. Get all active admissions
    // NOTE: Do NOT chain .populate() — those internal sub-queries run without
    // tenant context and get blocked. Fetch admissions plain, then manually
    // resolve doctor/patient with .unscoped().
    const admissions = await (IPDAdmission.find({ status: "Active" }) as any)
      .unscoped()
      .lean();

    for (const admission of admissions) {
      const vitals = (admission as any).vitals;
      if (!vitals || vitals.status === "Stable" || !vitals.lastVitalsRecordedAt)
        continue;

      // 2. Fetch specific thresholds for this hospital/ward
      const thresholdSet = await (
        VitalsThreshold.findOne({
          hospital: (admission as any).hospital,
          wardType: (admission as any).admissionType,
          isActive: true,
        }) as any
      ).unscoped();

      const criticalFreq = thresholdSet?.monitoringFrequency?.critical || 1; // Default 1h
      const warningFreq = thresholdSet?.monitoringFrequency?.warning || 8; // Default 8h

      const lastVitalsTime = new Date(vitals.lastVitalsRecordedAt).getTime();
      const now = Date.now();
      const diffHours = (now - lastVitalsTime) / (1000 * 60 * 60);

      let shouldEscalate = false;
      let message = "";

      // Manually resolve patient name with unscoped
      let patientName = "Patient";
      if ((admission as any).patient) {
        const Patient = (await import("../Patient/Models/Patient.js")).default;
        const patientData = await (
          Patient.findById((admission as any).patient) as any
        )
          .unscoped()
          .select("name")
          .lean();
        if (patientData) patientName = (patientData as any).name;
      }

      const patientIdentifier = `${patientName} (${(admission as any).admissionId})`;

      if (vitals.status === "Critical" && diffHours >= criticalFreq) {
        shouldEscalate = true;
        message = `ESCALATION: [${patientIdentifier}] hasn't been re-monitored for ${Math.floor(diffHours)}h (Target: ${criticalFreq}h). Vitals are ${vitals.status}.`;
      } else if (vitals.status === "Warning" && diffHours >= warningFreq) {
        shouldEscalate = true;
        message = `ESCALATION: [${patientIdentifier}] hasn't been re-monitored for ${Math.floor(diffHours)}h (Target: ${warningFreq}h). Vitals are ${vitals.status}.`;
      }

      if (shouldEscalate) {
        // Manually resolve the primary doctor's user ID with unscoped
        let doctorUserId: any = (admission as any).primaryDoctor;
        if (doctorUserId) {
          const docProfile = await (DoctorProfile.findById(doctorUserId) as any)
            .unscoped()
            .select("user")
            .lean();
          if (docProfile?.user) doctorUserId = docProfile.user;
        }

        // Check if we already sent an escalation notification in the last hour
        const recentNotif = await (
          Notification.findOne({
            recipient: doctorUserId,
            type: "vitals_escalation",
            relatedId: (admission as any)._id,
            createdAt: { $gte: new Date(now - 60 * 60 * 1000) },
          }) as any
        ).unscoped();

        if (!recentNotif) {
          await createNotification(null, {
            hospital: (admission as any).hospital,
            recipient: doctorUserId,
            sender: doctorUserId, // System triggered
            type: "vitals_escalation",
            message,
            relatedId: (admission as any)._id,
          });
          console.log(
            `[ReminderService] Monitoring escalation sent for ADM: ${(admission as any).admissionId}`,
          );
        }
      }
    }
  } catch (err) {
    console.error(
      "[ReminderService] Error in processVitalsMonitoringEscalation:",
      err,
    );
  }
};

/**
 * Initialize the reminder service with a periodic interval
 */
export const initReminderService = () => {
  console.log(
    "[ReminderService] Initializing automated follow-up reminders...",
  );

  // Check every 5 minutes to reduce load
  const INTERVAL = 5 * 60 * 1000;

  setInterval(processFollowUpReminders, INTERVAL);
  setInterval(processDischargeFollowUpReminders, INTERVAL); // IPD Follow-ups
  setInterval(processLicenseExpiryAlerts, 24 * 60 * 60 * 1000); // Check once a day
  setInterval(processVitalsMonitoringEscalation, 5 * 60 * 1000); // Check every 5 mins
};

/**
 * Service to process license/certification expiry alerts
 */
export const processLicenseExpiryAlerts = async () => {
  try {
    console.log("[ReminderService] Running License Expiry Checks...");

    // 1. Staff Profiles with license date
    const expiringStaff = await (
      StaffProfile.find({
        "qualificationDetails.licenseValidityDate": {
          $exists: true,
          $ne: null,
        },
      }) as any)
        .unscoped()
        .populate({ path: "user", options: { unscoped: true } });

    for (const profile of expiringStaff) {
      await processSingleProfileExpiry(profile, "staff");
    }

    // 2. Doctor Profiles with registration expiry date
    const expiringDoctors = await (
      DoctorProfile.find({
        registrationExpiryDate: { $exists: true, $ne: null },
      }) as any)
        .unscoped()
        .populate({ path: "user", options: { unscoped: true } });

    for (const profile of expiringDoctors) {
      await processSingleProfileExpiry(profile, "doctor");
    }
  } catch (err) {
    console.error(
      "[ReminderService] Error in processLicenseExpiryAlerts:",
      err,
    );
  }
};

export const processSingleProfileExpiry = async (
  profile: any,
  type: "staff" | "doctor" = "staff",
) => {
  try {
    let validityDate: Date | undefined;

    if (type === "staff") {
      validityDate = profile.qualificationDetails?.licenseValidityDate;
    } else if (type === "doctor") {
      validityDate = profile.registrationExpiryDate;
    }

    if (!validityDate) return;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const expiryDate = new Date(validityDate);
    expiryDate.setHours(0, 0, 0, 0);

    const recipientId = profile.user?._id || profile.user;
    if (!recipientId) return;

    // ✅ ALWAYS CLEAR OLD ALERTS: Ensures we start fresh every time a specific profile check runs.
    // This handles "Safe" dates, "Intermediate" dates, and prevents stacking.
    await (
      Notification.updateMany(
        { recipient: recipientId, type: "license_expiry", isRead: false },
        { $set: { isRead: true } },
      ) as any
    ).unscoped();

    // Difference in days
    const diffDays = Math.ceil(
      (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    let alertType: "thirtyDay" | "sevenDay" | "oneDay" | "expired" | null =
      null;
    let message = "";

    if (diffDays <= 0) {
      // Expired or Today
      if (!profile.expiryAlertsSent?.expired) {
        alertType = "expired";
        message = `CRITICAL: Your professional license has EXPIRED or expires TODAY (${expiryDate.toLocaleDateString()}). Immediate renewal required!`;
      }
    } else if (diffDays <= 30 && !profile.expiryAlertsSent?.thirtyDay) {
      // Within 30 Days
      alertType = "thirtyDay";
      message = `REMINDER: Your professional license is set to expire in ${diffDays} days (${expiryDate.toLocaleDateString()}). Please initiate for your Certification renewal.`;
    }

    if (alertType && message) {
      // Create new notification if conditions met

      await createNotification(null, {
        hospital: profile.hospital,
        recipient: recipientId,
        sender: recipientId,
        type: "license_expiry",
        message,
        relatedId: profile._id,
      });

      // Update sent flag if it's one of the tracked ones
      if (["thirtyDay", "sevenDay", "oneDay", "expired"].includes(alertType)) {
        const update: any = {};
        update[`expiryAlertsSent.${alertType}`] = true;

        if (type === "staff") {
          await (
            StaffProfile.findByIdAndUpdate(profile._id, { $set: update }) as any
          ).unscoped();
        } else {
          await (
            DoctorProfile.findByIdAndUpdate(profile._id, {
              $set: update,
            }) as any
          ).unscoped();
        }

        console.log(
          `[ReminderService] Sent ${alertType} expiry alert to ${type} ${profile._id}`,
        );
      }
    }
  } catch (err) {
    console.error(
      "[ReminderService] Error in processSingleProfileExpiry:",
      err,
    );
  }
};
