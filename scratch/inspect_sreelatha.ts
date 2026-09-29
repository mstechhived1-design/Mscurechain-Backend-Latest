import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (err) {
  console.warn("⚠️ [DB] Failed to set custom DNS servers:", err);
}

import { calculateBillBreakdown } from "../IPD/Controllers/IPDBillingController.js";
import IPDAdmission from "../IPD/Models/IPDAdmission.js";
import IPDAdvancePayment from "../IPD/Models/IPDAdvancePayment.js";
import IPDExtraCharge from "../IPD/Models/IPDExtraCharge.js";
import Transaction from "../Admin/Models/Transaction.js";
import LabOrder from "../Lab/Models/LabOrder.js";
import { tenantLocalStorage } from "../middleware/tenantPlugin.js";

import "../Patient/Models/Patient.js";
import "../IPD/Models/BedOccupancy.js";
import "../IPD/Models/Bed.js";
import "../Pharmacy/Models/PharmacyOrder.js";
import "../Pharmacy/Models/IPDMedicineIssuance.js";

dotenv.config({ path: ".env" });
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function inspect() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to DB");

    await tenantLocalStorage.run({
      tenantId: null,
      userId: null,
      role: "superadmin",
      isSuperAdmin: true
    }, async () => {
      const patientId = "6a9262b6e81349c3330b422f";
      const admissions = await IPDAdmission.find({ patient: patientId }).lean();
      console.log("Admissions:", admissions.map((a: any) => ({
        _id: a._id,
        admissionId: a.admissionId,
        status: a.status,
        advancePaid: a.advancePaid,
        settlementPaid: a.settlementPaid,
        totalBilledAmount: a.totalBilledAmount
      })));

      for (const adm of admissions) {
        const advs = await IPDAdvancePayment.find({ admission: adm._id }).lean();
        console.log("Advances for", adm.admissionId, advs);

        const extras = await IPDExtraCharge.find({ admission: adm._id }).lean();
        console.log("Extras for", adm.admissionId, extras);

        const labs = await LabOrder.find({ admission: adm._id }).lean();
        console.log("Labs for", adm.admissionId, labs);

        const txs = await Transaction.find({ patient: patientId }).lean();
        console.log("Transactions for patient:", txs);

        const breakdown = await calculateBillBreakdown(adm._id.toString());
        console.log("Breakdown:", JSON.stringify(breakdown?.financials, null, 2));
      }
    });
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

inspect();
