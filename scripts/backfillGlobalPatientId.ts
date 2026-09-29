import mongoose from "mongoose";
import Appointment from "../Appointment/Models/Appointment.js";
import LabOrder from "../Lab/Models/LabOrder.js";
import LabToken from "../Lab/Models/LabToken.js";
import IPDAdmission from "../IPD/Models/IPDAdmission.js";
import Prescription from "../Prescription/Models/Prescription.js";
import PharmacyOrder from "../Pharmacy/Models/PharmacyOrder.js";
import PharmacyToken from "../Pharmacy/Models/PharmacyToken.js";
import VitalsRecord from "../IPD/Models/VitalsRecord.js";
import MedicationRecord from "../IPD/Models/MedicationRecord.js";
import ClinicalNote from "../IPD/Models/ClinicalNote.js";
import DietLog from "../IPD/Models/DietLog.js";
import IPDAdvancePayment from "../IPD/Models/IPDAdvancePayment.js";
import IPDExtraCharge from "../IPD/Models/IPDExtraCharge.js";
import VitalsAlert from "../IPD/Models/VitalsAlert.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

const models = [
  { name: "Appointment", model: Appointment },
  { name: "LabOrder", model: LabOrder },
  { name: "LabToken", model: LabToken },
  { name: "IPDAdmission", model: IPDAdmission },
  { name: "Prescription", model: Prescription },
  { name: "PharmacyOrder", model: PharmacyOrder },
  { name: "PharmacyToken", model: PharmacyToken },
  { name: "VitalsRecord", model: VitalsRecord },
  { name: "MedicationRecord", model: MedicationRecord },
  { name: "ClinicalNote", model: ClinicalNote },
  { name: "DietLog", model: DietLog },
  { name: "IPDAdvancePayment", model: IPDAdvancePayment },
  { name: "IPDExtraCharge", model: IPDExtraCharge },
  { name: "VitalsAlert", model: VitalsAlert },
];

async function backfill() {
  try {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/mscurechain";
    console.log(`Connecting to: ${mongoUri}`);
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    for (const { name, model } of models) {
      console.log(`Backfilling ${name}...`);

      // Update records where globalPatientId is missing or null
      // Use aggregation pipeline for field-to-field copy
      const result = await (model as any).updateMany(
        {
          $or: [
            { globalPatientId: { $exists: false } },
            { globalPatientId: null },
          ],
        },
        [{ $set: { globalPatientId: "$patient" } }],
      );

      console.log(
        `Finished ${name}: Matched ${result.matchedCount}, Modified ${result.modifiedCount}`,
      );
    }

    console.log("Migration complete!");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

backfill();
