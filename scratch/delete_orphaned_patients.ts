import mongoose from "mongoose";

const MONGO_URI = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function run() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected successfully.");

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("DB connection not initialized");
  }

  const patientCol = db.collection("patients");
  
  // Query to find orphaned patients
  const query = {
    $or: [
      { hospitals: { $size: 0 } },
      { hospitals: [] },
      { hospitals: { $exists: false } }
    ]
  };

  const orphanedPatientsCount = await patientCol.countDocuments(query);
  console.log(`Found ${orphanedPatientsCount} orphaned patients to delete.`);

  if (orphanedPatientsCount > 0) {
    const deleteResult = await patientCol.deleteMany(query);
    console.log(`Successfully deleted ${deleteResult.deletedCount} orphaned patients.`);
  } else {
    console.log("No orphaned patients to delete.");
  }

  await mongoose.disconnect();
  console.log("Disconnected.");
}

run().catch(console.error);
