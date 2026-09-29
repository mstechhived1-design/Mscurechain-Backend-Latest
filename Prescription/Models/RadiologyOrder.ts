import mongoose, { Schema, Document } from "mongoose";

export interface IRadiologyOrder extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  priority: "Routine" | "Urgent" | "Emergency";
  modality: "X-ray" | "USG" | "CT" | "MRI" | "Doppler";
  bodyPart: string;
  protocol: string;

  contrast: {
    requested:  boolean;
    type:       string;
    creatinine: number;
    allergy:    boolean;
  };

  safety: {
    pregnancy: boolean;
    implants:  boolean; // Specifically for MRI
  };

  clinicalIndication: string;
  notes?: string;
  
  status: "Pending" | "Reported" | "Cancelled";
  createdAt: Date;
  updatedAt: Date;
}

const RadiologyOrderSchema: Schema = new Schema(
  {
    prescriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Prescription",
      required: true,
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    hospital: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },

    priority: { 
      type: String, 
      enum: ["Routine", "Urgent", "Emergency"], 
      default: "Routine" 
    },
    modality: { 
      type: String, 
      enum: ["X-ray", "USG", "CT", "MRI", "Doppler"], 
      required: true 
    },
    bodyPart: { type: String, required: true },
    protocol: { type: String, required: true },

    contrast: {
      requested:  { type: Boolean, default: false },
      type:       { type: String, default: "" },
      creatinine: { type: Number, default: 0 },
      allergy:    { type: Boolean, default: false },
    },

    safety: {
      pregnancy: { type: Boolean, default: false },
      implants:  { type: Boolean, default: false },
    },

    clinicalIndication: { type: String, required: true },
    notes: { type: String },
    
    status: { 
      type: String, 
      enum: ["Pending", "Reported", "Cancelled"], 
      default: "Pending" 
    },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
RadiologyOrderSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IRadiologyOrder>("RadiologyOrder", RadiologyOrderSchema);
