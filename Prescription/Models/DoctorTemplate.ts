import mongoose, { Schema, Document } from "mongoose";

export interface IDoctorTemplate extends Document {
  doctor: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  shortcut: string; // e.g., '/fever'
  name: string;     // e.g., 'Basic Fever Workflow'
  department?: string;
  diagnosis?: string;
  chiefComplaints?: string;
  advice?: string;
  medicines: {
    name: string;
    genericName?: string;
    dosage: string;
    frequency: any;
    timing?: string;
    route?: string;
    duration: string;
    quantity?: string;
    instructions?: string;
  }[];
  suggestedTests?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const DoctorTemplateSchema: Schema = new Schema(
  {
    doctor: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    shortcut: { type: String, required: true },
    name: { type: String, required: true },
    department: { type: String },
    diagnosis: { type: String },
    chiefComplaints: { type: String },
    advice: { type: String },
    medicines: [
      {
        name: { type: String, required: true },
        genericName: { type: String },
        dosage: { type: String, required: true },
        frequency: { type: Schema.Types.Mixed, required: true },
        timing: { type: String },
        route: { type: String },
        duration: { type: String, required: true, default: 'As directed' },
        quantity: { type: String },
        instructions: { type: String },
      },
    ],
    suggestedTests: [{ type: String }],
  },
  {
    timestamps: true,
  }
);

DoctorTemplateSchema.index({ doctor: 1, shortcut: 1 }, { unique: true });
DoctorTemplateSchema.index({ hospital: 1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
DoctorTemplateSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IDoctorTemplate>(
  "DoctorTemplate",
  DoctorTemplateSchema
);
