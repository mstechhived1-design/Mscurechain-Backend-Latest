/**
 * Utility to generate rich, formatted WhatsApp text messages with the "Read More" strategy
 * matching the MS Billings design pattern.
 */

export const READ_MORE = String.fromCharCode(8206).repeat(4001);

export interface AppointmentMessageData {
  patientName: string;
  tokenNo?: string;
  tokenNumber?: string;
  token_number?: string;
  mrn?: string;
  appointmentId?: string;
  doctorName?: string;
  specialty?: string;
  date?: string | Date;
  timeSlot?: string;
  hospitalName?: string;
  fee?: number | string;
  paymentStatus?: string;
  instructions?: string;
}

export function formatDynamicWhatsAppCaption(
  primaryContent: string,
  collapsibleContent?: string,
  targetFoldThreshold: number = 780,
  maxTotalChars: number = 920
): string {
  const primary = (primaryContent || '').trim();
  const collapsible = (collapsibleContent || '').trim();

  if (!collapsible) {
    return primary;
  }

  const baseChars = primary.length + collapsible.length + 2;
  const needed = Math.max(0, targetFoldThreshold - baseChars);
  const maxPossible = Math.max(0, maxTotalChars - baseChars);

  const markerCount = Math.min(Math.max(needed, 280), maxPossible);
  const readMoreMarkers = String.fromCharCode(8206).repeat(markerCount);

  return `${primary}\n${readMoreMarkers}\n${collapsible}`;
}

export function buildRichAppointmentMessage(data: AppointmentMessageData): string {
  const pName = data.patientName || "Valued Patient";
  const isMongoId = (val?: string) => typeof val === "string" && /^[0-9a-fA-F]{24}$/.test(val);
  const getValidMrn = (val?: any) => (val && typeof val === "string" && !isMongoId(val)) ? val : null;

  const idStr = getValidMrn(data.mrn) || data.appointmentId || "N/A";
  const docName = data.doctorName ? (data.doctorName.startsWith("Dr.") ? data.doctorName : `Dr. ${data.doctorName}`) : "Attending Specialist";
  const spec = data.specialty || "General Consultation";
  const hospName = data.hospitalName || "MsCurechain Healthcare";

  let dateFormatted = "N/A";
  if (data.date) {
    try {
      dateFormatted = new Date(data.date).toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (e) {
      dateFormatted = String(data.date);
    }
  }

  const timeStr = data.timeSlot || "Scheduled Slot";
  const feeStr = data.fee ? `₹${data.fee}` : "Paid";
  const rawStatus = (data.paymentStatus || "PAID").toUpperCase();
  const isPaid = /PAID|COMPLETED/i.test(rawStatus) || (rawStatus !== "UNPAID" && rawStatus !== "PENDING" && Number(data.fee) > 0);
  const paymentStatusDisplay = isPaid ? "PAID" : "UNPAID";

  const rawToken = data.tokenNo || data.tokenNumber || data.token_number;
  const tokenDisplay = rawToken ? (!isNaN(Number(rawToken)) ? `#${String(rawToken).padStart(2, "0")}` : (String(rawToken).startsWith("#") ? rawToken : `#${rawToken}`)) : null;

  const primary = `*${hospName.toUpperCase()}*
━━━━━━━━━━━━━━━━━━
📋 *APPOINTMENT RECEIPT*
*Patient:* ${pName}
*Token No:* ${tokenDisplay || 'N/A'} | *MR No:* ${idStr}
*Doctor:* ${docName} (${spec})
*Date & Time:* ${dateFormatted} • ${timeStr}
*Payment:* ${feeStr} (${paymentStatusDisplay})
━━━━━━━━━━━━━━━━━━`;

  const instructions = `📌 *Important Patient Instructions:*
• Arrive 15 mins before scheduled time.
• Show this token/receipt at Front Desk.
• Bring previous records & prescriptions.
• Contact ${hospName} for queries.

Thank you for choosing ${hospName}. Stay Healthy.`;

  return formatDynamicWhatsAppCaption(primary, instructions);
}

export function buildRichFollowUpReminderMessage(data: {
  patientName: string;
  doctorName?: string;
  date?: string | Date;
  timeSlot?: string;
  hospitalName?: string;
  daysRemaining?: number;
  isExpired?: boolean;
}): string {
  const pName = data.patientName || "Valued Patient";
  const docName = data.doctorName ? (data.doctorName.startsWith("Dr.") ? data.doctorName : `Dr. ${data.doctorName}`) : "your Doctor";
  const hospName = data.hospitalName || "MsCurechain Healthcare";
  const timeStr = data.timeSlot || "hospital hours";

  let dateFormatted = "N/A";
  if (data.date) {
    try {
      dateFormatted = new Date(data.date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    } catch (e) {
      dateFormatted = String(data.date);
    }
  }

  if (data.isExpired) {
    return `*FOLLOW-UP WINDOW EXPIRATION ALERT*
━━━━━━━━━━━━━━━━━━━━
Hi *${pName}*,
Your follow-up consultation window with *${docName}* at *${hospName}* has expired or is expiring today (${dateFormatted}).
${READ_MORE}
━━━━━━━━━━━━━━━━━━━━
*What to do next:*
Please schedule a new appointment or contact our helpdesk to renew your consultation token.

Contact Front Desk or use the MsCurechain App to book your visit!`;
  }

  const daysText = data.daysRemaining === 1 ? "Tomorrow" : `in ${data.daysRemaining} days`;

  return `*UPCOMING FOLLOW-UP REMINDER*
━━━━━━━━━━━━━━━━━━━━
Hi *${pName}*,
This is a friendly reminder for your upcoming follow-up checkup with *${docName}* at *${hospName}*.
${READ_MORE}
━━━━━━━━━━━━━━━━━━━━
*Follow-Up Date:* ${dateFormatted} (${daysText})
*Time Slot:* ${timeStr}

*Reminder:* Please bring your previous prescription and diagnostic reports.

We look forward to seeing you! Stay Healthy!`;
}

export interface PatientWelcomeMessageData {
  patientName: string;
  mrn: string;
  mobile: string;
  gender?: string;
  age?: number | string;
  registrationDate?: string | Date;
  hospitalName?: string;
  hospitalAddress?: string;
  hospitalPhone?: string;
  hospitalEmail?: string;
}

export function buildPatientWelcomeMessage(data: PatientWelcomeMessageData): string {
  const hName = data.hospitalName || "Hospital Healthcare";
  let dateStr = "Today";
  if (data.registrationDate) {
    try {
      const d = new Date(data.registrationDate);
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        dateStr = `${day}/${month}/${year}`;
      }
    } catch (_) { }
  } else {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    dateStr = `${day}/${month}/${year}`;
  }

  return `🎉 *WELCOME TO ${hName.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━━
Dear *${data.patientName}*,

Thank you for choosing *${hName}*! Your patient registration has been successfully confirmed.

📋 *PATIENT DETAILS:*
• *Patient Name:* ${data.patientName}
• *MRN / Patient ID:* ${data.mrn}
• *Registered Mobile:* ${data.mobile}${data.gender ? `\n• *Gender:* ${data.gender}` : ""}${data.age ? `\n• *Age:* ${data.age}` : ""}
• *Registration Date:* ${dateStr}

🏥 *HOSPITAL DETAILS:*
• *Hospital:* ${hName}${data.hospitalAddress ? `\n• *Address:* ${data.hospitalAddress}` : ""}${data.hospitalPhone ? `\n• *Helpline:* ${data.hospitalPhone}` : ""}${data.hospitalEmail ? `\n• *Email:* ${data.hospitalEmail}` : ""}
━━━━━━━━━━━━━━━━━━━━
${READ_MORE}
💡 *Important Note:*
Please keep your MRN (*${data.mrn}*) safe. You can use it for all future appointments, consultations, and accessing your medical history at ${hName}.

We are committed to your health and well-being! Stay Healthy! 🏥`;
}

