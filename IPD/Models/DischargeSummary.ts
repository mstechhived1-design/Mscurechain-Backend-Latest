import mongoose, { Schema, Document, Types } from "mongoose";
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";

export interface IDischargeMedicine {
    id?: string;
    medicineName: string;
    dose: string;
    frequency: string;
    duration: string;
    quantity?: string;
}

export interface IDischargeSummary extends Document {
    patient: Types.ObjectId;
    hospital: Types.ObjectId;
    admission?: Types.ObjectId;
    admissionId?: string;
    reportId?: Types.ObjectId;
    chiefComplaints?: string;
    historyOfPresentIllness?: string;
    pastMedicalHistory?: string;
    examinationFindings?: string;
    provisionalDiagnosis?: string;
    finalDiagnosis?: string;
    investigations?: string;
    treatmentAndCourse?: string;
    conditionAtDischarge?: string;
    dischargeMedications: IDischargeMedicine[];
    dietAndActivityAdvice?: string;
    woundCarePrecautions?: string;
    followUpDate?: string;
    warningSymptoms?: string;
    savedBy?: string;
    createdAt: Date;
    updatedAt: Date;
}

const dischargeMedicineSchema = new Schema<IDischargeMedicine>({
    id: { type: String },
    medicineName: { type: String, required: true },
    dose: { type: String, default: "" },
    frequency: { type: String, default: "" },
    duration: { type: String, default: "" },
    quantity: { type: String, default: "" }
}, { _id: false });

const dischargeSummarySchema = new Schema<IDischargeSummary>({
    patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Patient",
        required: true,
        index: true
    },
    hospital: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Hospital",
        required: true,
        index: true
    },
    admission: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "IPDAdmission",
        index: true
    },
    admissionId: { type: String, index: true },
    reportId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TransactionReport",
        index: true
    },
    chiefComplaints: { type: String, default: "" },
    historyOfPresentIllness: { type: String, default: "" },
    pastMedicalHistory: { type: String, default: "" },
    examinationFindings: { type: String, default: "" },
    provisionalDiagnosis: { type: String, default: "" },
    finalDiagnosis: { type: String, default: "" },
    investigations: { type: String, default: "" },
    treatmentAndCourse: { type: String, default: "" },
    conditionAtDischarge: { type: String, default: "" },
    dischargeMedications: {
        type: [dischargeMedicineSchema],
        default: []
    },
    dietAndActivityAdvice: { type: String, default: "" },
    woundCarePrecautions: { type: String, default: "" },
    followUpDate: { type: String, default: "" },
    warningSymptoms: { type: String, default: "" },
    savedBy: { type: String, default: "frontdesk" }
}, { timestamps: true });

dischargeSummarySchema.plugin(multiTenancyPlugin);

export default mongoose.model<IDischargeSummary>("DischargeSummary", dischargeSummarySchema);
