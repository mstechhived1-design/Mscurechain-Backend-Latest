import mongoose, { Schema, Document, Types } from "mongoose";

export interface IHospitalLabConfig extends Document {
  hospital: Types.ObjectId;
  enabledDepartments: string[];
  barcodeEnabled: boolean;
  qrVerificationEnabled: boolean;
  allowCustomTests: boolean;
  defaultReportTemplate: string;
  isActive: boolean;
  methods: string[];
  sampleTypes: string[];
  units: string[];
  createdAt: Date;
  updatedAt: Date;
}

const hospitalLabConfigSchema = new Schema<IHospitalLabConfig>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true, unique: true },
    enabledDepartments: [{ type: String }],
    barcodeEnabled: { type: Boolean, default: false },
    qrVerificationEnabled: { type: Boolean, default: false },
    allowCustomTests: { type: Boolean, default: true },
    defaultReportTemplate: { type: String, default: "standard" },
    isActive: { type: Boolean, default: true },
    methods: [{ type: String }],
    sampleTypes: [{ type: String }],
    units: [{ type: String }],
  },
  { timestamps: true }
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
hospitalLabConfigSchema.plugin(multiTenancyPlugin, {
  includeGlobal: false,
  requireTenant: true,
});

const HospitalLabConfig = mongoose.model<IHospitalLabConfig>(
  "HospitalLabConfig",
  hospitalLabConfigSchema
);

export default HospitalLabConfig;
