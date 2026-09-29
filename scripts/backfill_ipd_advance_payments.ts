import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (err) {
  console.warn("⚠️ [DB] Failed to set custom DNS servers:", err);
}

import IPDAdmission from "../IPD/Models/IPDAdmission.js";
import IPDAdvancePayment from "../IPD/Models/IPDAdvancePayment.js";
import Transaction from "../Admin/Models/Transaction.js";
import Appointment from "../Appointment/Models/Appointment.js";
import redisService from "../config/redis.js";
import { tenantLocalStorage } from "../middleware/tenantPlugin.js";
import "../Patient/Models/Patient.js";
import "../Patient/Models/PatientProfile.js";

dotenv.config({ path: ".env" });
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to DB");

  await tenantLocalStorage.run({
    tenantId: null,
    userId: null,
    role: "superadmin",
    isSuperAdmin: true
  }, async () => {
    // Find admissions where advancePaid > 0 or amount > 0
    const admissions = await IPDAdmission.find({
      $or: [
        { advancePaid: { $gt: 0 } },
        { amount: { $gt: 0 } }
      ]
    }).lean();

    console.log(`Checking ${admissions.length} admissions...`);

    let createdCount = 0;

    for (const adm of admissions) {
      const existingCount = await IPDAdvancePayment.countDocuments({ admission: adm._id });
      if (existingCount === 0) {
        console.log(`\nAdmission ${adm.admissionId} (${adm._id}) has advancePaid=${adm.advancePaid}, amount=${adm.amount}, but 0 IPDAdvancePayment records.`);

        // Find linked appointment or transaction
        const linkedAppt: any = await Appointment.findOne({
          $or: [
            { admissionId: adm._id },
            { appointmentId: adm.admissionId },
            { patient: adm.patient, isIPD: true }
          ]
        }).sort({ createdAt: -1 }).lean();

        const linkedTx: any = await Transaction.findOne({
          $or: [
            { referenceId: adm._id },
            { transactionId: adm.admissionId },
            ...(linkedAppt ? [{ referenceId: linkedAppt._id }] : []),
            { user: adm.patient, type: "ipd_advance", status: "completed" }
          ]
        }).sort({ createdAt: 1 }).lean();

        const targetAmount = adm.advancePaid || adm.amount || linkedTx?.amount || 0;
        if (targetAmount > 0) {
          const rawMode = linkedTx?.paymentMode || linkedAppt?.payment?.paymentMethod || adm.paymentMethod || "Cash";
          const modeUpper = rawMode.toLowerCase() === "upi" ? "UPI" : rawMode.toLowerCase() === "card" ? "Card" : rawMode.toLowerCase() === "mixed" ? "Mixed" : "Cash";
          const receipt = linkedTx?.receiptNumber || linkedTx?.transactionId || linkedAppt?.appointmentId || adm.admissionId;

          const newPayment = await IPDAdvancePayment.create({
            patient: adm.patient,
            globalPatientId: adm.globalPatientId || adm.patient,
            admission: adm._id,
            hospital: adm.hospital,
            amount: targetAmount,
            mode: modeUpper,
            paymentDetails: linkedTx?.paymentDetails || linkedAppt?.payment?.paymentDetails || {
              cash: modeUpper === "Cash" ? targetAmount : 0,
              upi: modeUpper === "UPI" ? targetAmount : 0,
              card: modeUpper === "Card" ? targetAmount : 0,
            },
            transactionType: "Advance",
            reference: receipt,
            transactionId: receipt,
            receiptNumber: receipt,
            date: linkedTx?.date || linkedAppt?.createdAt || adm.admissionDate || adm.createdAt,
            receivedBy: adm.createdBy || linkedTx?.user || adm.patient,
          });

          console.log(`✅ Created IPDAdvancePayment ${newPayment._id} for admission ${adm.admissionId} with amount ₹${targetAmount}, receipt ${receipt}, mode ${modeUpper}`);
          createdCount++;

          // Clear redis cache
          try {
            await redisService.del(`ipd:bill:${adm._id}`);
            await redisService.del(`ipd:bill:${adm.admissionId}`);
          } catch (e) {
            // Redis error non-fatal
          }
        }
      }
    }

    console.log(`\nBackfill complete! Created ${createdCount} missing IPDAdvancePayment records.`);
  });

  await mongoose.disconnect();
}

run().catch(console.error);
