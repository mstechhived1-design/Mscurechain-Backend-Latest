import { Document, Types } from "mongoose";

export interface IIncident extends Document {
    incidentId: string;
    incidentDate: Date;
    hospital: Types.ObjectId;
    department: 'OPD' | 'IPD' | 'ICU' | 'OT' | 'Pharmacy' | 'Lab';
    incidentType: 'Patient Fall' | 'Medication Error' | 'Equipment Failure' | 'Delay in Treatment' | 'Violence' | 'Near Miss' | 'Adverse Drug Reaction' | 'Other';
    severity: 'Low' | 'Medium' | 'High';
    description: string;
    reportedBy: Types.ObjectId;

    // Conditional Fields
    patientFallDetails?: {
        patientName: string;
        mrnNumber: string;
        bedNumber: string;
        roomNumber: string;
    };
    equipmentFailureDetails?: {
        equipmentName: string;
        causeOfFailure: string;
    };
    medicationErrorDetails?: {
        prescriptionOrDrugName: string;
    };

    // Attachments (photos/images)
    attachments?: Array<{
        url: string;
        publicId: string;
        fileName?: string;
    }>;

    status: 'OPEN' | 'IN REVIEW' | 'CLOSED';
    adminResponse?: {
        adminId: Types.ObjectId;
        message: string;
        actionTaken: string;
        respondedAt: Date;
    };
    createdAt: Date;
    updatedAt: Date;
}
