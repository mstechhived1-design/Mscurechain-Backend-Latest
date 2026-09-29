import mongoose from "mongoose";

const MONGO_URI = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

const TARGET_HOSPITALS = [
  "69b79239f8366a7ea539300a",
  "69bfb379f4b25c11c272a6d4",
  "69ce094a66dd84b7c7b5b014",
  "69e720e5059b501407bb88d4",
  "69c6201f6b5011c242af3b21"
];

const targetObjectIds = TARGET_HOSPITALS.map(id => new mongoose.Types.ObjectId(id));

async function run() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected successfully.");

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("DB connection not initialized");
  }

  const collections = await db.listCollections().toArray();
  const summary: any[] = [];

  // 1. SPECIFIC CLEANUP FOR HOSPITALS
  console.log("\n1. Cleaning up 'hospitals' collection...");
  const hospitalCol = db.collection("hospitals");
  const delHospitals = await hospitalCol.deleteMany({
    _id: { $in: targetObjectIds }
  });
  console.log(`Deleted ${delHospitals.deletedCount} hospital documents.`);
  summary.push({
    collection: "hospitals",
    action: "delete",
    count: delHospitals.deletedCount
  });

  // 2. SPECIFIC CLEANUP FOR USERS
  console.log("\n2. Cleaning up 'users' collection...");
  const userCol = db.collection("users");
  
  // Delete non-patient users
  const delUsers = await userCol.deleteMany({
    hospital: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] },
    role: { $ne: "patient" }
  });
  console.log(`Deleted ${delUsers.deletedCount} non-patient user documents.`);
  summary.push({
    collection: "users (non-patients deleted)",
    action: "delete",
    count: delUsers.deletedCount
  });

  // Unset hospital for patient users if any exist
  const updatePatientUsers = await userCol.updateMany(
    {
      hospital: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] },
      role: "patient"
    },
    {
      $unset: { hospital: "" }
    }
  );
  console.log(`Updated ${updatePatientUsers.modifiedCount} patient user documents (unset hospital).`);
  summary.push({
    collection: "users (patients updated)",
    action: "update (unset hospital)",
    count: updatePatientUsers.modifiedCount
  });

  // 3. SPECIFIC CLEANUP FOR PATIENTS
  console.log("\n3. Cleaning up 'patients' collection...");
  const patientCol = db.collection("patients");
  const updatePatients = await patientCol.updateMany(
    {
      hospitals: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] }
    },
    {
      $pull: { hospitals: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } }
    }
  );
  console.log(`Updated ${updatePatients.modifiedCount} patient documents (removed hospital links).`);
  summary.push({
    collection: "patients",
    action: "update (pull hospitals)",
    count: updatePatients.modifiedCount
  });

  // 4. CLEANUP OTHER COLLECTIONS
  console.log("\n4. Cleaning up remaining collections...");
  for (const colInfo of collections) {
    const colName = colInfo.name;
    if (colName === "hospitals" || colName === "users" || colName === "patients") {
      continue;
    }

    const collection = db.collection(colName);
    
    // We target any potential hospital reference fields: hospital, hospitalId, hospital_id, tenantId
    const deleteQuery = {
      $or: [
        { hospital: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } },
        { hospitalId: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } },
        { hospital_id: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } },
        { tenantId: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } }
      ]
    };

    const res = await collection.deleteMany(deleteQuery);
    if (res.deletedCount > 0) {
      console.log(`Collection '${colName}': Deleted ${res.deletedCount} documents.`);
      summary.push({
        collection: colName,
        action: "delete",
        count: res.deletedCount
      });
    }
  }

  console.log("\n--- CLEANUP COMPLETE ---");
  console.table(summary);

  // 5. POST-CLEANUP VERIFICATION SCAN
  console.log("\n--- POST-CLEANUP VERIFICATION CHECK ---");
  let totalViolations = 0;
  for (const colInfo of collections) {
    const colName = colInfo.name;
    const collection = db.collection(colName);

    let query: any = {};
    if (colName === "patients") {
      query = { hospitals: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } };
    } else if (colName === "users") {
      query = { hospital: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } };
    } else if (colName === "hospitals") {
      query = { _id: { $in: targetObjectIds } };
    } else {
      query = {
        $or: [
          { hospital: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } },
          { hospitalId: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } },
          { hospital_id: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } },
          { tenantId: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } }
        ]
      };
    }

    const count = await collection.countDocuments(query);
    if (count > 0) {
      console.error(`⚠️ WARNING: Collection '${colName}' still has ${count} documents referencing the target hospital IDs!`);
      totalViolations += count;
    }
  }

  if (totalViolations === 0) {
    console.log("🟢 SUCCESS: Verification check passed! No remaining references to target hospital IDs were found.");
  } else {
    console.error(`🔴 FAILURE: Found ${totalViolations} remaining references to target hospital IDs.`);
  }

  await mongoose.disconnect();
  console.log("Disconnected.");
}

run().catch(console.error);
