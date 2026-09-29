import mongoose, { Schema } from "mongoose";
import { IHospital } from "../types/index.js";

const branchSchema = new mongoose.Schema({
  name: String,
  address: String,
  phone: String,
  mobile: String,
  createdAt: { type: Date, default: Date.now },
});

const employeeRefSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  role: String,
});

const hospitalSchema = new Schema<IHospital>(
  {
    hospitalId: { type: String, unique: true, sparse: true },
    name: { type: String, required: true },
    gstNumber: String,
    address: { type: String, required: true },
    street: String,
    landmark: String,
    city: String,
    area: String,
    state: String,
    location: { lat: Number, lng: Number },
    geofenceSettings: {
      enabled: { type: Boolean, default: false },
      radiusMeters: { type: Number, default: 500 },
      excludedPortals: { type: [String], default: ["hospital-admin", "masterhelpdesk"] },
      restrictedPortals: { type: [String], default: [] }
    },
    phone: String,
    logo: String,
    registrationNumber: String,
    email: String,
    pincode: String,
    establishedYear: Number,
    specialities: [String],
    services: [String],
    ambulanceAvailability: { type: Boolean, default: false },
    rating: Number,
    website: String,
    operatingHours: String,
    status: {
      type: String,
      enum: ["pending", "approved", "suspended"],
      default: "pending",
    },
    branches: [branchSchema],
    employees: [employeeRefSchema],
    unitTypes: {
      type: [String],
      default: [],
    },
    billingCategories: {
      type: [String],
      default: [
        "Consultation",
        "Procedure",
        "Pharmacy",
        "Laboratory",
        "Radiology",
        "Nursing",
        "Equipments",
        "Other",
      ],
    },
    clinicalNoteTypes: {
      type: [String],
      default: [
        "Progress Note",
        "Nursing Assessment",
        "Medication Administration Note",
        "Post-Op Monitoring",
        "Incident",
        "Shift Handover",
      ],
    },
    clinicalNoteVisibilities: {
      type: [String],
      default: ["Nurse", "Doctor", "Admin"],
    },
    ipdPharmaSettings: {
      enabledWards: { type: [String], default: [] },
    },
    portalLicenses: {
      type: new Schema({
        masterhelpdesk: { enabled: { type: Boolean, default: false }, startDate: Date, endDate: Date },
        helpdesk:       { enabled: { type: Boolean, default: false }, startDate: Date, endDate: Date },
        doctor:         { enabled: { type: Boolean, default: false }, startDate: Date, endDate: Date },
        pharmacy:       { enabled: { type: Boolean, default: false }, startDate: Date, endDate: Date },
        lab:            { enabled: { type: Boolean, default: false }, startDate: Date, endDate: Date },
        nurse:          { enabled: { type: Boolean, default: false }, startDate: Date, endDate: Date },
        hospitalAdmin:  { enabled: { type: Boolean, default: false }, startDate: Date, endDate: Date },
        staff:          { enabled: { type: Boolean, default: false }, startDate: Date, endDate: Date },
        hr:             { enabled: { type: Boolean, default: false }, startDate: Date, endDate: Date },
        discharge:      { enabled: { type: Boolean, default: false }, startDate: Date, endDate: Date },
      }, { _id: false }),
      default: {},
    },
    availablePortals: {
      type: [String],
      default: [],
    },
    opdFollowUpDays: {
      type: Number,
      default: 7,
    },
    ipdFollowUpDays: {
      type: Number,
      default: 7,
    },
    enableFollowUpExpiry: {
      type: Boolean,
      default: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
hospitalSchema.plugin(multiTenancyPlugin, {
  requireTenant: false,
  scoping: false, // Hospital is a root entity and never scoped by a tenant field
});

const Hospital = mongoose.model<IHospital>("Hospital", hospitalSchema);
export default Hospital;
