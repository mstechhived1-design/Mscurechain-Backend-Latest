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
  
  // Find patients with empty hospitals array
  const orphanedPatients = await patientCol.find({
    $or: [
      { hospitals: { $size: 0 } },
      { hospitals: [] },
      { hospitals: { $exists: false } }
    ]
  }).toArray();

  console.log(`\nFound ${orphanedPatients.length} patients who are not linked to any remaining hospitals:`);
  
  if (orphanedPatients.length > 0) {
    const list = orphanedPatients.map(p => ({
      id: p._id.toString(),
      name: p.name,
      mobile: p.mobile,
      email: p.email || "N/A",
      createdAt: p.createdAt
    }));
    console.table(list);
  } else {
    console.log("No orphaned patients found.");
  }

  await mongoose.disconnect();
}

run().catch(console.error);
