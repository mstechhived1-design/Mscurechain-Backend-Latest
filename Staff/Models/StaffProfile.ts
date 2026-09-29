import mongoose, { Schema } from "mongoose";
import { IStaffProfile } from "../types/index.js";

const staffProfileSchema = new Schema<IStaffProfile>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    honorific: { type: String, enum: ["Mr", "Mrs", "Ms", "Dr"] },

    // Professional Details
    department: { type: [String], default: [] },
    assignedRoom: { type: [String], default: [] },
    designation: { type: String },
    employeeId: { type: String },
    employmentType: {
      type: String,
      enum: ["full-time", "part-time", "contract"],
      default: "full-time",
    },
    experienceYears: { type: Number },
    joiningDate: { type: Date },

    // Contact & Personal
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: String,
    },
    emergencyContact: {
      name: String,
      mobile: String,
      relationship: String,
    },
    bloodGroup: { type: String },

    // Work Schedule
    shift: { type: Schema.Types.ObjectId, ref: "Shift" },
    workingHours: {
      start: { type: String, default: "09:00" },
      end: { type: String, default: "17:00" },
    },
    shiftStart: { type: String, default: "09:00" }, // Legacy compat
    shiftEnd: { type: String, default: "17:00" }, // Legacy compat
    weeklyOff: [{ type: String }],

    // Qualifications
    qualifications: [{ type: String }],
    certifications: [{ type: String }],
    skills: [{ type: String }],
    languages: [{ type: String }],

    // Qualification Details & Documents
    qualificationDetails: {
      registrationNumber: { type: String },
      licenseValidityDate: { type: Date },
      qualifications: [{ type: String }],
    },
    documents: {
      type: Schema.Types.Mixed,
      default: {},
    },
    expiryAlertsSent: {
      thirtyDay: { type: Boolean, default: false },
      sevenDay: { type: Boolean, default: false },
      oneDay: { type: Boolean, default: false },
      expired: { type: Boolean, default: false },
    },

    // Extras
    notes: { type: String },
    bio: { type: String, maxlength: 150, default: "" },
    qrSecret: { type: String, required: true, unique: true },

    // Status
    status: {
      type: String,
      enum: ["active", "inactive", "suspended", "terminated"],
      default: "active",
    },
    terminationDate: { type: Date },
    terminationReason: { type: String },

    // Leave Quotas (Monthly)
    sickLeaveQuota: { type: Number, default: 1 },
    emergencyLeaveQuota: { type: Number, default: 1 },

    // Salary & Payroll Info
    baseSalary: { type: Number, default: 0 },
    panNumber: { type: String },
    pfNumber: { type: String },
    esiNumber: { type: String },
    uanNumber: { type: String },
    aadharNumber: { type: String },
    fatherName: { type: String },
    dob: { type: Date },
    workLocation: { type: String },
    gender: { type: String },

    allowances: [
      {
        type: { type: String, required: true },
        amount: { type: Number, required: true },
      },
    ],
    deductions: [
      {
        type: { type: String, required: true },
        amount: { type: Number, required: true },
      },
    ],
    bankDetails: {
      accountName: String,
      accountNumber: String,
      bankName: String,
      ifscCode: String,
    },
    quickNotes: [
      {
        text: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
import { encrypt, decrypt } from "../../utils/crypto.js";

// 🔐 SECURITY: Auto-Encrypt Sensitive Fields before saving
staffProfileSchema.pre("save", function (next) {
  if (this.panNumber) this.panNumber = encrypt(this.panNumber);
  if (this.aadharNumber) this.aadharNumber = encrypt(this.aadharNumber);
  if (this.pfNumber) this.pfNumber = encrypt(this.pfNumber);
  if (this.esiNumber) this.esiNumber = encrypt(this.esiNumber);
  if (this.uanNumber) this.uanNumber = encrypt(this.uanNumber);

  if (this.bankDetails) {
    // FIX: String() coercion prevents non-string values from bypassing encrypt()
    if (this.bankDetails.accountNumber)
      this.bankDetails.accountNumber = encrypt(String(this.bankDetails.accountNumber));
    if (this.bankDetails.ifscCode)
      this.bankDetails.ifscCode = encrypt(String(this.bankDetails.ifscCode));
    if (this.bankDetails.accountName)
      this.bankDetails.accountName = encrypt(String(this.bankDetails.accountName));
  }
  next();
});

// 🔐 SECURITY: Auto-Encrypt Sensitive Fields on update
const encryptUpdate = function (this: any, next: any) {
  const update = this.getUpdate();
  if (!update) return next();

  const data = update.$set || update;

  if (data.panNumber) data.panNumber = encrypt(data.panNumber);
  if (data.aadharNumber) data.aadharNumber = encrypt(data.aadharNumber);
  if (data.pfNumber) data.pfNumber = encrypt(data.pfNumber);
  if (data.esiNumber) data.esiNumber = encrypt(data.esiNumber);
  if (data.uanNumber) data.uanNumber = encrypt(data.uanNumber);

  if (data.bankDetails) {
    // FIX: String() coercion prevents non-string values from bypassing encrypt()
    if (data.bankDetails.accountNumber)
      data.bankDetails.accountNumber = encrypt(String(data.bankDetails.accountNumber));
    if (data.bankDetails.ifscCode)
      data.bankDetails.ifscCode = encrypt(String(data.bankDetails.ifscCode));
    if (data.bankDetails.accountName)
      data.bankDetails.accountName = encrypt(String(data.bankDetails.accountName));
  }
  next();
};

staffProfileSchema.pre("findOneAndUpdate", encryptUpdate);
staffProfileSchema.pre("updateOne", encryptUpdate);

// 🔐 SECURITY: Auto-Decrypt Sensitive Fields after fetching
const decryptFields = (doc: any) => {
  if (!doc) return;
  if (doc.panNumber) doc.panNumber = decrypt(doc.panNumber);
  if (doc.aadharNumber) doc.aadharNumber = decrypt(doc.aadharNumber);
  if (doc.pfNumber) doc.pfNumber = decrypt(doc.pfNumber);
  if (doc.esiNumber) doc.esiNumber = decrypt(doc.esiNumber);
  if (doc.uanNumber) doc.uanNumber = decrypt(doc.uanNumber);

  if (doc.bankDetails) {
    if (doc.bankDetails.accountNumber)
      doc.bankDetails.accountNumber = decrypt(doc.bankDetails.accountNumber);
    if (doc.bankDetails.ifscCode)
      doc.bankDetails.ifscCode = decrypt(doc.bankDetails.ifscCode);
    if (doc.bankDetails.accountName)
      doc.bankDetails.accountName = decrypt(doc.bankDetails.accountName);
  }
};

staffProfileSchema.post("findOne", decryptFields);
staffProfileSchema.post("save", decryptFields);
staffProfileSchema.post("find", (docs) => {
  if (Array.isArray(docs)) {
    docs.forEach(decryptFields);
  }
});

staffProfileSchema.plugin(multiTenancyPlugin);

// Performance Index
staffProfileSchema; // .index({ hospital: 1 }) removed to prevent duplicate index with tenantPlugin;

const StaffProfile = mongoose.model<IStaffProfile>(
  "StaffProfile",
  staffProfileSchema,
);
export default StaffProfile;
