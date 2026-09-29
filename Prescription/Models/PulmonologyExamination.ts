import mongoose from "mongoose";

const PulmonologyExaminationSchema = new mongoose.Schema(
  {
    prescriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prescription",
      required: true,
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },

    vitals: {
      respRate: { type: Number, required: true },
      spo2: { type: Number, required: true,},
      oxygenSupport: {
        type: String,
        enum: ["Room Air", "Nasal Oxygen", "Mask", "Ventilator", ""],
        default: "Room Air",
      },
    },

    symptoms: [{
      type: String,
      enum: ["Dry cough", "Productive cough", "Breathlessness", "Wheeze", "Chest pain", "Fever", "Hemoptysis"],
    }],

    mmrcGrade: {
      type: Number,
    },

    exam: {
      chestExpansion: {
        type: String,
        enum: ["Normal", "Reduced", "Asymmetrical", ""],
        default: "Normal"
      },
      accessoryMuscles: {
        type: String,
        enum: ["Yes", "No", ""],
        default: ""
      },
    },

    auscultation: {
      airEntry: {
        type: String,
        enum: ["Normal", "Reduced Right", "Reduced Left", "Absent", ""],
        default: "Normal"
      },
      sounds: [{
        type: String,
        enum: ["Wheeze", "Crackles", "Stridor", "Pleural Rub"],
      }],
    },

    peakFlow: {
      type: Number,
    },

    diagnosis: {
      type: String,
    },
    severity: {
      type: String,
      enum: ["Mild", "Moderate", "Severe", "Acute Exacerbation", ""],
      default: ""
    },

    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

// Add Multi-tenancy support
import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
PulmonologyExaminationSchema.plugin(multiTenancyPlugin);

const PulmonologyExamination = mongoose.model("PulmonologyExamination", PulmonologyExaminationSchema);
export default PulmonologyExamination;
