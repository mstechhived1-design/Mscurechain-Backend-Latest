import mongoose, { Schema } from "mongoose";
import { IDoctorProfile } from "../types/index.js";

const doctorProfileSchema = new Schema<IDoctorProfile>(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assignedHelpdesk: { type: mongoose.Schema.Types.ObjectId, ref: "HelpDesk" },
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    }, // Single hospital
    honorific: { type: String, enum: ["Mr", "Mrs", "Ms", "Dr"] },
    specialties: [String],
    consultationFee: { type: Number },
    availability: [
      {
        days: [String],
        startTime: String,
        breakStart: String,
        breakEnd: String,
        endTime: String,
      },
    ],
    qualifications: [String],
    experienceStart: Date,
    bio: String,
    profilePic: String,
    quickNotes: [
      {
        text: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    medicalRegistrationNumber: { type: String },
    registrationCouncil: { type: String },
    registrationYear: { type: Number },
    registrationExpiryDate: { type: Date },
    degreeCertificate: { type: String }, // URL
    registrationCertificate: { type: String }, // URL
    doctorateCertificate: { type: String }, // URL (New)
    internshipCertificate: { type: String }, // URL (New)
    documents: {
      type: Schema.Types.Mixed,
      default: {},
    },
    employeeId: { type: String, required: true },
    consultationDuration: { type: Number },
    maxAppointmentsPerDay: { type: Number },
    isOnline: { type: Boolean, default: true },

    // Address
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: String,
    },

    // Permissions
    permissions: {
      canAccessEMR: { type: Boolean, default: true },
      canAccessBilling: { type: Boolean, default: false },
      canAccessLabReports: { type: Boolean, default: true },
      canPrescribe: { type: Boolean, default: true },
      canAdmitPatients: { type: Boolean, default: false },
      canPerformSurgery: { type: Boolean, default: false },
    },

    // Additional Information
    languages: [{ type: String }],
    awards: [{ type: String }],

    // Expiry Alert Flags
    expiryAlertsSent: {
      thirtyDay: { type: Boolean, default: false },
      sevenDay: { type: Boolean, default: false },
      oneDay: { type: Boolean, default: false },
      expired: { type: Boolean, default: false },
    },

    // Salary & Payroll Info
    baseSalary: { type: Number, default: 0 },
    panNumber: { type: String },
    aadharNumber: { type: String },
    pfNumber: { type: String },
    esiNumber: { type: String },
    uanNumber: { type: String },
    bankDetails: {
      accountName: String,
      accountNumber: String,
      bankName: String,
      ifscCode: String,
    },
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
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
import { encrypt, decrypt } from "../../utils/crypto.js";

// 🔐 SECURITY: Auto-Encrypt Sensitive Fields before saving
doctorProfileSchema.pre("save", function (next) {
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

doctorProfileSchema.pre("findOneAndUpdate", encryptUpdate);
doctorProfileSchema.pre("updateOne", encryptUpdate);

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

doctorProfileSchema.post("findOne", decryptFields);
doctorProfileSchema.post("save", decryptFields);
doctorProfileSchema.post("find", (docs) => {
  if (Array.isArray(docs)) {
    docs.forEach(decryptFields);
  }
});

doctorProfileSchema.plugin(multiTenancyPlugin);

doctorProfileSchema.virtual("experience").get(function (this: IDoctorProfile) {
  if (!this.experienceStart) return null;
  const start = new Date(this.experienceStart);
  const now = new Date();
  let totalMonths =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) totalMonths -= 1;
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years <= 0 && months <= 0) return "Less than a month";
  if (years > 0 && months > 0)
    return `${years} year${years > 1 ? "s" : ""} ${months} month${months > 1 ? "s" : ""}`;
  if (years > 0) return `${years} year${years > 1 ? "s" : ""}`;
  return `${months} month${months > 1 ? "s" : ""}`;
});

// Indexes for performance
doctorProfileSchema; // .index({ hospital: 1 }) removed to prevent duplicate index with tenantPlugin;
doctorProfileSchema.index({ user: 1 });

const DoctorProfile = mongoose.model<IDoctorProfile>(
  "DoctorProfile",
  doctorProfileSchema,
);
export default DoctorProfile;
