import { Server } from "socket.io";
import IPDAdmission from "../Models/IPDAdmission.js";
import MedicationRecord from "../Models/MedicationRecord.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import User from "../../Auth/Models/User.js";
import { createNotification } from "../../Notification/Controllers/notificationController.js";
import VitalsRecord from "../Models/VitalsRecord.js";

/**
 * Background Task for Nurse Hourly Monitoring & Medication Reminders
 */
export const startMonitoringTasks = (io: Server) => {
  // Run every minute
  setInterval(async () => {
    try {
      const now = new Date();
      const currentHour = now.getHours();

      const admissionsDue = await (IPDAdmission.find({
        status: "Active",
        "vitals.nextVitalsDue": { $lte: now },
      }) as any)
        .unscoped()
        .populate({
          path: "patient",
          select: "name",
          options: { unscoped: true },
        });

      for (const admission of admissionsDue) {
        // Find who recorded the last vitals to notify the "same nurse"
        const lastRecord = await (VitalsRecord.findOne({
          admission: admission._id,
        }) as any).unscoped().sort({ timestamp: -1 });

        if (lastRecord && lastRecord.recordedBy) {
          const nurseId = lastRecord.recordedBy.toString();
          const patientName = (admission.patient as any)?.name || "Patient";

          // Prevent duplicate notifications in the same hour if already notified
          // We can check if a notification was already sent recently (within last 30 mins)
          // For simplicity, we'll just send it, frontend can handle de-duplication or we can check last notification time

          const timeStr = now.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
          const dateStr = now.toLocaleDateString([], {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
          const dayStr = now.toLocaleDateString([], { weekday: "long" });

          const reminderMessage = `UPDATE VITALS: Please update vitals for ${patientName} (${admission.admissionId}) due at ${timeStr}, ${dateStr} (${dayStr})`;

          // Use null/undefined for sender since "SYSTEM" is not a valid ObjectId
          await createNotification({ io } as any, {
            hospital: admission.hospital,
            recipient: nurseId,
            sender: undefined,
            type: "vitals_due",
            message: reminderMessage,
            relatedId: admission._id as any,
          });

          io.to(`user_${nurseId}`).emit("vitals_due_alert", {
            patientName,
            admissionId: admission.admissionId,
            message: reminderMessage,
          });

          // Update nextVitalsDue to prevent immediate re-notification
          // Set it to 5 minutes forward just for this check interval,
          // until the nurse actually logs new vitals which will set it to the real next hour
          await (IPDAdmission.findByIdAndUpdate(admission._id, {
            $set: {
              "vitals.nextVitalsDue": new Date(now.getTime() + 10 * 60 * 1000),
            },
          }) as any).unscoped();
        }
      }

      // 2. Medication Reminders at Standard Times
      // Morning: 9 AM, Afternoon: 1 PM (13), Night: 8 PM (20)
      let timeSlot: "Morning" | "Afternoon" | "Night" | null = null;
      if (currentHour === 9 && now.getMinutes() === 0) timeSlot = "Morning";
      if (currentHour === 13 && now.getMinutes() === 0) timeSlot = "Afternoon";
      if (currentHour === 20 && now.getMinutes() === 0) timeSlot = "Night";

      // For testing or robustness, we can check if we are within the first 5 minutes of these hours
      if (!timeSlot) {
        if (currentHour === 9 && now.getMinutes() < 5) timeSlot = "Morning";
        else if (currentHour === 13 && now.getMinutes() < 5)
          timeSlot = "Afternoon";
        else if (currentHour === 20 && now.getMinutes() < 5) timeSlot = "Night";
      }

      if (timeSlot) {
        // Find all active admissions
        const activeAdmissions = await (IPDAdmission.find({
          status: "Active",
        }) as any).unscoped().populate({ path: "patient", select: "name", options: { unscoped: true } });

        for (const adm of activeAdmissions) {
          // Find prescriptions for this patient
          // This is simplified; in a real scenario we'd check if the medicine was ALREADY given for this slot today
          const prescriptions = await (Prescription.find({
            $or: [{ admission: adm._id }, { patient: adm.patient._id }],
            status: "Active",
          }) as any).unscoped();

          for (const presc of prescriptions) {
            for (const med of presc.medicines) {
              if (med.frequency?.includes(timeSlot)) {
                // Check if already administered today
                const startOfDay = new Date();
                startOfDay.setHours(0, 0, 0, 0);
                const alreadyGiven = await (MedicationRecord.findOne({
                  admission: adm._id,
                  medicineId:
                    (med as any)._id || (med as any).medicineId || med.name,
                  timeSlot,
                  timestamp: { $gte: startOfDay },
                }) as any).unscoped();

                if (!alreadyGiven) {
                  // Notify nurses in this hospital/department
                  // For simplicity, we notify the last nurse who attended this patient
                  const lastNurse = await (VitalsRecord.findOne({
                    admission: adm._id,
                  }) as any).unscoped().sort({ timestamp: -1 });
                  const recipientId =
                    lastNurse?.recordedBy || adm.primaryDoctor;

                  if (recipientId) {
                    await createNotification({ io } as any, {
                      hospital: adm.hospital,
                      recipient: recipientId.toString(),
                      sender: undefined,
                      type: "medication_due",
                      message: `MEDICATION DUE: ${med.name} for ${(adm.patient as any).name} (${adm.admissionId}) (${timeSlot})`,
                      relatedId: adm._id as any,
                    });

                    io.to(`user_${recipientId}`).emit("medication_due_alert", {
                      patientName: (adm.patient as any).name,
                      medicineName: med.name,
                      timeSlot,
                      message: `Medication ${med.name} is due for ${(adm.patient as any).name} (${adm.admissionId})`,
                    });
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Monitoring Tasks Error:", error);
    }
  }, 60 * 1000); // Run every minute
};
