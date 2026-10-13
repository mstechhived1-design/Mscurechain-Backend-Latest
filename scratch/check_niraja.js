import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGO_URI;

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  
  const appt = await db.collection("appointments").findOne({ _id: new mongoose.Types.ObjectId("6acccd8d23662cdbd700a859") });
  console.log("=== APPOINTMENT ===");
  console.log(JSON.stringify(appt, null, 2));

  const profile = await db.collection("patientprofiles").findOne({ mrn: "HHO235000144" }) || await db.collection("patientprofiles").findOne({ mrn: "HH0235000144" });
  console.log("=== PATIENT PROFILE ===");
  console.log(JSON.stringify(profile, null, 2));

  let patient = null;
  if (profile?.user) {
    patient = await db.collection("patients").findOne({ _id: profile.user });
  } else if (appt?.patient) {
    patient = await db.collection("patients").findOne({ _id: appt.patient });
  }
  console.log("=== PATIENT ===");
  console.log(JSON.stringify(patient, null, 2));

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
