import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IReminderConfiguration extends Document {
  hospital: mongoose.Schema.Types.ObjectId;
  opdReminderSlots: { hour: number; minute: number; isEnabled?: boolean }[];
  ipdReminderDays: number[];
  isActive: boolean;
  enablePortalReminders: boolean;
  enableWhatsAppReminders: boolean;
  featureCutoffDate?: Date;
}

const reminderConfigurationSchema = new Schema<IReminderConfiguration>(
  {
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      unique: true,
    },
    opdReminderSlots: [
      {
        hour: { type: Number, required: true },
        minute: { type: Number, required: true },
        isEnabled: { type: Boolean, default: true },
      },
    ],
    ipdReminderDays: [{ type: Number }],
    isActive: { type: Boolean, default: true },
    enablePortalReminders: { type: Boolean, default: true },
    enableWhatsAppReminders: { type: Boolean, default: true },
    featureCutoffDate: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
reminderConfigurationSchema.plugin(multiTenancyPlugin, { indexTenant: false });

const ReminderConfiguration = mongoose.model<IReminderConfiguration>(
  "ReminderConfiguration",
  reminderConfigurationSchema,
);
export default ReminderConfiguration;
