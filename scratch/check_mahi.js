import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGO_URI;

async function check() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const profile = await db.collection("patientprofiles").findOne({ mrn: "HHO771000143" });
  console.log("=== PATIENT PROFILE ===");
  console.log(JSON.stringify(profile, null, 2));

  const patient = await db.collection("patients").findOne({ mobile: "9701800140" });
  console.log("=== PATIENT ===");
  console.log(JSON.stringify(patient, null, 2));

  const user = await db.collection("users").findOne({ mobile: "9701800140" });
  console.log("=== USER ===");
  console.log(JSON.stringify(user, null, 2));

  const labOrder = await db.collection("laborders").findOne({ sampleId: "SMP-0233" });
  console.log("=== LAB ORDER SMP-0233 ===");
  console.log(JSON.stringify(labOrder, null, 2));

  process.exit(0);
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
