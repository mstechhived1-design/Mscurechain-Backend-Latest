import mongoose, { Schema, Document } from "mongoose";

export interface IENTExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;

  // A. Ear Examination
  ear: {
    left: {
      externalEar?: "Normal" | "Infection" | "Swelling";
      earCanal?: ("Clear" | "Wax" | "Discharge" | "Foreign Body")[];
      tympanicMembrane?: "Normal" | "Perforated" | "Retracted" | "Bulging";
    };
    right: {
      externalEar?: "Normal" | "Infection" | "Swelling";
      earCanal?: ("Clear" | "Wax" | "Discharge" | "Foreign Body")[];
      tympanicMembrane?: "Normal" | "Perforated" | "Retracted" | "Bulging";
    };
  };

  // B. Hearing Assessment
  hearing: {
    status?: "Normal" | "Reduced" | "Absent";
    tuningForkTest?: (
      | "Rinne Positive"
      | "Rinne Negative"
      | "Weber Central"
      | "Weber Lateralized"
    )[];
  };

  // C. Nose Examination
  nose: {
    mucosa?: "Normal" | "Congested" | "Inflamed";
    septum?: "Midline" | "Deviated";
    discharge?: "None" | "Serous" | "Purulent" | "Bloody";
  };

  // D. Throat / Oral Cavity
  throat: {
    tonsils?: "Normal" | "Enlarged" | "With Pus";
    pharynx?: "Normal" | "Congested" | "Inflamed";
    uvula?: "Central" | "Deviated";
  };

  // E. Lymph Nodes
  lymphNodes: {
    cervical?: "Not Palpable" | "Enlarged";
    sizeCm?: number;
    tender?: "Yes" | "No";
    mobility?: "Mobile" | "Fixed";
  };

  // F. Voice / Airway
  voice: {
    quality?: "Normal" | "Hoarseness" | "Aphonia";
    airway?: "Patent" | "Obstructed";
  };

  // G. Symptoms
  symptoms: (
    | "Ear Pain"
    | "Hearing Loss"
    | "Tinnitus"
    | "Nasal Block"
    | "Nasal Discharge"
    | "Sore Throat"
    | "Difficulty Swallowing"
  )[];

  // H. Duration
  duration?: "Acute" | "Subacute" | "Chronic";

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EarSideSchema = new Schema(
  {
    externalEar: {
      type: String,
      enum: ["Normal", "Infection", "Swelling"],
    },
    earCanal: {
      type: [String],
      enum: ["Clear", "Wax", "Discharge", "Foreign Body"],
      validate: {
        validator: function (val: string[]) {
          // Clear cannot coexist with Wax
          return !(val.includes("Clear") && val.includes("Wax"));
        },
        message: "Ear canal cannot be both 'Clear' and 'Wax' simultaneously",
      },
    },
    tympanicMembrane: {
      type: String,
      enum: ["Normal", "Perforated", "Retracted", "Bulging"],
    },
  },
  { _id: false },
);

const ENTExaminationSchema: Schema = new Schema(
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

    // A. Ear
    ear: {
      left: { type: EarSideSchema, default: {} },
      right: { type: EarSideSchema, default: {} },
    },

    // B. Hearing
    hearing: {
      status: {
        type: String,
        enum: ["Normal", "Reduced", "Absent"],
      },
      tuningForkTest: {
        type: [String],
        enum: [
          "Rinne Positive",
          "Rinne Negative",
          "Weber Central",
          "Weber Lateralized",
        ],
      },
    },

    // C. Nose
    nose: {
      mucosa: {
        type: String,
        enum: ["Normal", "Congested", "Inflamed"],
      },
      septum: {
        type: String,
        enum: ["Midline", "Deviated"],
      },
      discharge: {
        type: String,
        enum: ["None", "Serous", "Purulent", "Bloody"],
      },
    },

    // D. Throat
    throat: {
      tonsils: {
        type: String,
        enum: ["Normal", "Enlarged", "With Pus"],
      },
      pharynx: {
        type: String,
        enum: ["Normal", "Congested", "Inflamed"],
      },
      uvula: {
        type: String,
        enum: ["Central", "Deviated"],
      },
    },

    // E. Lymph Nodes
    lymphNodes: {
      cervical: {
        type: String,
        enum: ["Not Palpable", "Enlarged"],
      },
      sizeCm: {
        type: Number,
      },
      tender: {
        type: String,
        enum: ["Yes", "No"],
      },
      mobility: {
        type: String,
        enum: ["Mobile", "Fixed"],
      },
    },

    // F. Voice / Airway
    voice: {
      quality: {
        type: String,
        enum: ["Normal", "Hoarseness", "Aphonia"],
      },
      airway: {
        type: String,
        enum: ["Patent", "Obstructed"],
      },
    },

    // G. Symptoms
    symptoms: {
      type: [String],
      enum: [
        "Ear Pain",
        "Hearing Loss",
        "Tinnitus",
        "Nasal Block",
        "Nasal Discharge",
        "Sore Throat",
        "Difficulty Swallowing",
      ],
    },

    // H. Duration
    duration: {
      type: String,
      enum: ["Acute", "Subacute", "Chronic"],
    },

    notes: { type: String },
  },
  { timestamps: true },
);

// Compound indices for analytics
ENTExaminationSchema.index({ hospital: 1, createdAt: -1 });
ENTExaminationSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
ENTExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IENTExamination>(
  "ENTExamination",
  ENTExaminationSchema,
);
