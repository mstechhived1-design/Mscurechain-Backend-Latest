import mongoose, { Types } from "mongoose";
import * as dotenv from "dotenv";
import * as dns from "dns";

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (err) {
  console.warn("⚠️ [DB] Failed to set custom DNS servers:", err);
}

import { tenantLocalStorage } from "../middleware/tenantPlugin.js";
import PatientProfile from "../Patient/Models/PatientProfile.js";
import TransactionReport from "../Report/Models/TransactionReport.js";

dotenv.config({ path: ".env" });

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function verifyDocRef() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const hospitalId = "6a0850656ecbe4898e5d0dfe";
    const tenantObjectId = new Types.ObjectId(hospitalId);

    // Run within tenant context using ObjectId for tenantId
    await tenantLocalStorage.run({
      tenantId: tenantObjectId,
      userId: null,
      role: "superadmin",
      isSuperAdmin: true,
    }, async () => {
      console.log("Checking PatientProfiles...");
      const profiles: any[] = await PatientProfile.find({
        $or: [
          { doctorReference: { $exists: true, $ne: "" } },
          { referredBy: { $exists: true, $ne: "" } }
        ]
      }).limit(5).lean();

      console.log(`Found ${profiles.length} profiles with doctor reference:`);
      for (const p of profiles) {
        console.log(`- Patient: ${p.fullName || p.firstName || 'N/A'}, MRN: ${p.mrn}, DocRef: ${p.doctorReference}, ReferredBy: ${p.referredBy}`);
      }

      console.log("Checking TransactionReports...");
      const reports: any[] = await TransactionReport.find({
        $or: [
          { doctorReference: { $exists: true, $ne: "" } },
          { referredBy: { $exists: true, $ne: "" } }
        ]
      }).limit(5).lean();

      console.log(`Found ${reports.length} transaction reports with doctor reference:`);
      for (const r of reports) {
        console.log(`- Report ID: ${r._id}, DocRef: ${r.doctorReference}, ReferredBy: ${r.referredBy}`);
      }
    });

  } catch (err) {
    console.error("Error in verifyDocRef:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

verifyDocRef();
