import mongoose from "mongoose";
import Hospital from "../../Hospital/Models/Hospital.js";
import whatsappManager from "./whatsappManager.js";
import { buildPatientWelcomeMessage } from "./whatsappMessageBuilder.js";

interface SendWelcomeParams {
  hospitalId: string | mongoose.Types.ObjectId;
  patientName: string;
  mrn: string;
  mobile: string;
  gender?: string;
  age?: number | string;
  registrationDate?: string | Date;
}

export interface WelcomeResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Sends a welcome / registration confirmation WhatsApp message to a newly registered patient.
 * Directly awaits delivery and returns an honest result object for the registration response.
 */
export async function sendPatientWelcomeWhatsApp(params: SendWelcomeParams): Promise<WelcomeResult> {
  const { hospitalId, patientName, mrn, mobile, gender, age, registrationDate } = params;

  if (!mobile || !hospitalId) {
    const reason = `Missing ${!mobile ? 'mobile number' : 'hospital context'}`;
    console.warn(`[PatientWelcomeWhatsApp] ⚠️ ${reason}`);
    return { success: false, error: reason };
  }

  try {
    const hospIdStr = hospitalId.toString();

    let hospital: any = null;
    if (mongoose.Types.ObjectId.isValid(hospIdStr)) {
      hospital = await Hospital.findById(hospIdStr).lean();
    }
    if (!hospital) {
      hospital = await Hospital.findOne({ hospitalId: hospIdStr }).lean();
    }

    const hospitalName = hospital?.name || "Horizin Hospital";

    const fullAddress = [
      hospital?.address,
      hospital?.street,
      hospital?.landmark,
      hospital?.city,
      hospital?.state,
      hospital?.pincode ? `- ${hospital.pincode}` : ""
    ].filter(Boolean).join(", ");

    const waService = whatsappManager.getInstance(hospIdStr, hospitalName);
    if (!waService) {
      return { success: false, error: `WhatsApp gateway not found for ${hospitalName}` };
    }

    const welcomeMsg = buildPatientWelcomeMessage({
      patientName,
      mrn,
      mobile,
      gender,
      age,
      registrationDate,
      hospitalName,
      hospitalAddress: fullAddress || hospital?.address || undefined,
      hospitalPhone: hospital?.phone || undefined,
      hospitalEmail: hospital?.email || undefined,
    });

    console.log(`[PatientWelcomeWhatsApp] 📤 Dispatching welcome message to ${patientName} (${mobile}) for ${hospitalName}...`);

    // Wrap with timeout so registration API never hangs indefinitely
    const sendPromise = waService.sendTextMessage(mobile, welcomeMsg);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("WhatsApp send timed out after 5s")), 5000)
    );

    await Promise.race([sendPromise, timeoutPromise]);
    console.log(`[PatientWelcomeWhatsApp] ✅ Welcome WhatsApp message delivered to ${patientName} (${mobile})`);
    return {
      success: true,
      message: `Welcome WhatsApp message sent to +91 ${mobile}`,
    };
  } catch (err: any) {
    const errMsg = err?.message || "Failed to deliver WhatsApp welcome message";
    console.error(`[PatientWelcomeWhatsApp] ❌ Error delivering to ${patientName}:`, errMsg);
    return {
      success: false,
      error: errMsg,
    };
  }
}
