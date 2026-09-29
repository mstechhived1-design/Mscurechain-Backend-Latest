import mongoose, { Schema, Document } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IReminderConfiguration extends Document {
  hospital: mongoose.Schema.Types.ObjectId;
  opdReminderSlots: { hour: number; minute: number }[];
  ipdReminderDays: number[];
  isActive: boolean;
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
      },
    ],
    ipdReminderDays: [{ type: Number }],
    isActive: { type: Boolean, default: true },
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
