import mongoose, { Schema, Document } from "mongoose";

export interface IWhatsAppConfig extends Document {
  hospitalId: string;
  status: "DISCONNECTED" | "SCAN_QR" | "CONNECTING" | "CONNECTED";
  connectedNumber: string | null;
  deviceName: string | null;
  linkedAt: Date | null;
  templates: {
    welcomeMessage: string;
    appointmentConfirmation: string;
    appointmentReminder: string;
    paymentReceipt: string;
    labReportReady: string;
    dischargeSummary: string;
    feedbackMessage: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const whatsappConfigSchema = new Schema<IWhatsAppConfig>(
  {
    hospitalId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["DISCONNECTED", "SCAN_QR", "CONNECTING", "CONNECTED"],
      default: "DISCONNECTED",
    },
    connectedNumber: { type: String, default: null },
    deviceName: { type: String, default: null },
    linkedAt: { type: Date, default: null },
    templates: {
      welcomeMessage: { type: String, default: "" },
      appointmentConfirmation: { type: String, default: "" },
      appointmentReminder: { type: String, default: "" },
      paymentReceipt: { type: String, default: "" },
      labReportReady: { type: String, default: "" },
      dischargeSummary: { type: String, default: "" },
      feedbackMessage: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

const WhatsAppConfig = mongoose.model<IWhatsAppConfig>("WhatsAppConfig", whatsappConfigSchema);
export default WhatsAppConfig;
