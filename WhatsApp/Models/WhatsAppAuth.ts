import mongoose, { Schema, Document } from "mongoose";

export interface IWhatsAppAuth extends Document {
  hospitalId: string;
  id: string;
  data: string;
  createdAt: Date;
  updatedAt: Date;
}

const whatsappAuthSchema = new Schema<IWhatsAppAuth>(
  {
    hospitalId: { type: String, required: true, index: true },
    id: { type: String, required: true },
    data: { type: String, required: true },
  },
  { timestamps: true }
);

// High-Speed Indexes for Query Optimization, important for Baileys auth state restoration
whatsappAuthSchema.index({ hospitalId: 1, id: 1 }, { unique: true });
whatsappAuthSchema.index({ createdAt: -1 });
whatsappAuthSchema.index({ updatedAt: -1 });

const WhatsAppAuth = mongoose.model<IWhatsAppAuth>("WhatsAppAuth", whatsappAuthSchema);
export default WhatsAppAuth;
