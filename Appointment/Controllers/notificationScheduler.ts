import { createNotification } from "../../Notification/Controllers/notificationController.js";
import MobileAppointment from "../Models/MobileAppointment.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import mongoose from "mongoose";

// In-memory track for engagement (resets on restart, but that's fine for now)
let lastEngagementDate: string | null = null;
let targetEngagementHour: number = 9;

const ENGAGEMENT_MESSAGES = [
  "Stay healthy! Don't forget to drink plenty of water today. 💧",
  "Check out our health tips of the day in the MsCureChain app! 🩺",
  "Your wellness is our priority. Schedule your next routine checkup soon! ✨",
  "Keep track of your vitals easily with our new mobile booking system. 📊",
];

/**
 * Combine Date and Time string ("09:00 AM") into a Date object
 */
function getFullAppointmentDate(date: Date, timeStr: string): Date {
  const d = new Date(date);
  const [time, modifier] = timeStr.split(" ");
  let [hours, minutes] = time.split(":").map(Number);
  
  if (modifier === "PM" && hours < 12) hours += 12;
  if (modifier === "AM" && hours === 12) hours = 0;
  
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export const startNotificationScheduler = () => {
  console.log("🚀 Starting Notification Scheduler Task...");
  
  // Every 5 minutes for reminders
  setInterval(async () => {
    await processAppointmentReminders();
  }, 5 * 60 * 1000);

  // Every 1 hour for engagement (randomness check)
  setInterval(async () => {
    await processEngagementNotifications();
  }, 60 * 60 * 1000);
};

async function processAppointmentReminders() {
  try {
    const now = new Date();
    const appointments = await (
      MobileAppointment.find({
        status: { $in: ["Booked", "Confirmed"] },
        date: { $gte: new Date(now.setHours(0, 0, 0, 0)) },
      }) as any
    )
      .unscoped()
      .populate({ path: "doctor", options: { unscoped: true } })
      .populate({ path: "hospital", options: { unscoped: true } })
      .populate({ path: "patient", options: { unscoped: true } });

    const currentNow = new Date();

    for (const app of appointments) {
      if (!app.patient) continue;
      
      const appDateTime = getFullAppointmentDate(app.date, app.startTime);
      const diffMs = appDateTime.getTime() - currentNow.getTime();
      const diffHrs = diffMs / (1000 * 60 * 60);

      const intervals = [
        { key: "3d", label: "3 days", limit: 3 * 24 },
        { key: "2d", label: "2 days", limit: 2 * 24 },
        { key: "1d", label: "1 day",  limit: 1 * 24 },
        { key: "3h", label: "3 hours", limit: 3 },
        { key: "1h", label: "1 hour",  limit: 1 },
      ];

      for (const { key, label, limit } of intervals) {
        // If we are within the limit (e.g. less than 3 days left) but not past the appointment
        if (diffHrs > 0 && diffHrs <= limit && !app.remindersSent.includes(key)) {
          const doctorName = (app.doctor as any)?.name || "your doctor";
          const patientName = (app.patient as any)?.name || "you";
          const message = `Reminder for ${patientName}: Your appointment with ${doctorName} is in ${label} (${app.startTime} on ${app.date.toDateString().split(' ').slice(1,3).join(' ')}).`;
          
          await createNotification(null, {
            recipient: (app.patient as any).user,
            recipientModel: "Patient",
            type: "appointment_reminder",
            message,
            relatedId: app._id,
            hospital: (app.hospital as any)?._id
          });

          app.remindersSent.push(key);
          await app.save();
          console.log(`[Scheduler] Sent ${key} reminder for app ${app.appointmentId}`);
          break; // Send only the most relevant one in this pass
        }
      }
    }
  } catch (error) {
    console.error("[Scheduler] Reminder processing error:", error);
  }
}

async function processEngagementNotifications() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const now = new Date();
    const currentHour = now.getHours();

    // Reset for new day
    if (lastEngagementDate !== today) {
      lastEngagementDate = today;
      // Pick a random hour between 9 and 18 (6 PM)
      targetEngagementHour = Math.floor(Math.random() * (18 - 9 + 1)) + 9;
      console.log(`[Scheduler] Today's engagement target hour: ${targetEngagementHour}:00`);
    }

    // If it's the target hour and we haven't sent yet in this hour
    if (currentHour === targetEngagementHour) {
      // Broadcast to all active patients
      const patients = await (
        PatientProfile.find({}) as any
      ).unscoped().select("user name");
      const randomMsg = ENGAGEMENT_MESSAGES[Math.floor(Math.random() * ENGAGEMENT_MESSAGES.length)];

      for (const p of patients) {
        if (!p.user) continue;
        const patientName = (p as any).name || "there";
        await createNotification(null, {
          recipient: p.user,
          recipientModel: "User",
          type: "app_engagement",
          message: `Hello ${patientName}! ${randomMsg}`
        });
      }
      
      console.log(`[Scheduler] Broadcasted daily engagement message.`);
      // Move target to 99 so it doesn't fire again today
      targetEngagementHour = 99; 
    }
  } catch (error) {
    console.error("[Scheduler] Engagement processing error:", error);
  }
}
