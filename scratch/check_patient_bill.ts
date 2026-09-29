import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

// Force using reliable DNS servers to resolve MongoDB Atlas SRV records
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (err) {
  console.warn("⚠️ [DB] Failed to set custom DNS servers:", err);
}

import { calculateBillBreakdown } from "../IPD/Controllers/IPDBillingController.js";
import IPDAdmission from "../IPD/Models/IPDAdmission.js";
import { tenantLocalStorage } from "../middleware/tenantPlugin.js";

// Register all required models so populate works
import "../Patient/Models/Patient.js";
import "../IPD/Models/BedOccupancy.js";
import "../IPD/Models/Bed.js";
import "../IPD/Models/IPDExtraCharge.js";
import "../Pharmacy/Models/PharmacyOrder.js";
import "../Lab/Models/LabOrder.js";
import "../IPD/Models/IPDAdvancePayment.js";
import "../Pharmacy/Models/IPDMedicineIssuance.js";
import "../Admin/Models/Transaction.js";

dotenv.config({ path: ".env" });

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function check() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to DB");

    await tenantLocalStorage.run({
      tenantId: null,
      userId: null,
      role: "superadmin",
      isSuperAdmin: true
    }, async () => {
      const patientId = "6a05bf8312ee21a2a85812e3";
      const admission = await IPDAdmission.findOne({
        patient: patientId,
      }).sort({ admissionDate: -1 });

      if (!admission) {
        console.log("No admission found");
        return;
      }

      console.log("Admission ID:", admission._id);
      const breakdown = await calculateBillBreakdown(admission._id.toString());
      console.log("Breakdown Result:");
      console.log(JSON.stringify(breakdown, null, 2));
    });

  } catch (error) {
    console.error(error);
  } finally {
    await mongoose.connection.close();
  }
}

check();
