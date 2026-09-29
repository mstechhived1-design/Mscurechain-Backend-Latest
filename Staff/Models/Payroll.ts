import mongoose, { Schema } from "mongoose";
import { IPayroll } from "../types/index.js";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

const payrollSchema = new Schema<IPayroll>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    month: { type: Number },
    year: { type: Number },
    startDate: { type: Date },
    endDate: { type: Date },
    baseSalary: { type: Number, required: true },
    totalAllowances: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    netSalary: { type: Number, required: true },
    attendanceDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    leaveDays: { type: Number, default: 0 },
    monthDays: { type: Number, default: 30 },
    weeklyOffDays: { type: Number, default: 0 },

    // Identity & Fiscal Context (Snapshot at time of generation)
    bankAccount: { type: String },
    panNumber: { type: String },
    pfNumber: { type: String },
    esiNumber: { type: String },
    uanNumber: { type: String },
    aadharNumber: { type: String },
    fatherName: { type: String },
    dob: { type: Date },
    gender: { type: String },
    workLocation: { type: String },
    designation: { type: String },
    department: { type: String },

    breakdown: {
      basic: { type: Number },
      hra: { type: Number },
      transportAllowance: { type: Number },
      medicalAllowance: { type: Number },
      specialAllowance: { type: Number },
      salaryArrears: { type: Number },
      bonus: { type: Number },
      pf: { type: Number },
      esi: { type: Number },
      professionalTax: { type: Number },
      salaryAdvance: { type: Number },
      tds: { type: Number },
    },

    ctc: {
      grossEarning: { type: Number },
      pensionFund: { type: Number },
      providentFund: { type: Number },
      employerEsi: { type: Number },
      totalCTC: { type: Number },
    },

    status: {
      type: String,
      enum: ["draft", "processed", "paid", "cancelled"],
      default: "draft",
    },
    paymentDate: { type: Date },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "cash", "check"],
      default: "bank_transfer",
    },
    transactionId: { type: String },
    payslipUrl: { type: String },
    notes: { type: String },
    processedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// Indexes
payrollSchema.index({ hospital: 1, status: 1 });
payrollSchema.index({ startDate: 1, endDate: 1 });
payrollSchema.index({ user: 1, startDate: 1, endDate: 1 });

// ✅ FIX: Multi-tenancy plugin for automatic hospital scoping
payrollSchema.plugin(multiTenancyPlugin);

const Payroll = mongoose.model<IPayroll>("Payroll", payrollSchema);
export default Payroll;
