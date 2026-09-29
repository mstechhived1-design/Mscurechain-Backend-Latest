import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/CureChain";

async function run() {
  console.log("Connecting to database:", MONGO_URI);
  await mongoose.connect(MONGO_URI);
  console.log("Connected to database");

  const db = mongoose.connection.db!;

  // 1. Transactions collection
  const transactionsResult1 = await db.collection("transactions").updateMany(
    { patientType: "walkin" },
    { $set: { patientType: "opd" } }
  );
  console.log(`Updated ${transactionsResult1.modifiedCount} transactions (walkin -> opd)`);

  const transactionsResult2 = await db.collection("transactions").updateMany(
    { patientType: "inpatient" },
    { $set: { patientType: "ipd" } }
  );
  console.log(`Updated ${transactionsResult2.modifiedCount} transactions (inpatient -> ipd)`);

  // 2. LabOrders collection
  const ordersResult1 = await db.collection("laborders").updateMany(
    { "patientDetails.patientType": "walkin" },
    { $set: { "patientDetails.patientType": "opd" } }
  );
  console.log(`Updated ${ordersResult1.modifiedCount} lab orders (walkin -> opd)`);

  const ordersResult2 = await db.collection("laborders").updateMany(
    { "patientDetails.patientType": "inpatient" },
    { $set: { "patientDetails.patientType": "ipd" } }
  );
  console.log(`Updated ${ordersResult2.modifiedCount} lab orders (inpatient -> ipd)`);

  // 3. DirectLabOrders collection
  const directOrdersResult1 = await db.collection("directlaborders").updateMany(
    { "patientDetails.patientType": "walkin" },
    { $set: { "patientDetails.patientType": "opd" } }
  );
  console.log(`Updated ${directOrdersResult1.modifiedCount} direct lab orders (walkin -> opd)`);

  const directOrdersResult2 = await db.collection("directlaborders").updateMany(
    { "patientDetails.patientType": "inpatient" },
    { $set: { "patientDetails.patientType": "ipd" } }
  );
  console.log(`Updated ${directOrdersResult2.modifiedCount} direct lab orders (inpatient -> ipd)`);

  // 4. LabTokens collection (if patientType is present)
  const labTokensResult1 = await db.collection("labtokens").updateMany(
    { "patientDetails.patientType": "walkin" },
    { $set: { "patientDetails.patientType": "opd" } }
  );
  console.log(`Updated ${labTokensResult1.modifiedCount} lab tokens (walkin -> opd)`);

  const labTokensResult2 = await db.collection("labtokens").updateMany(
    { "patientDetails.patientType": "inpatient" },
    { $set: { "patientDetails.patientType": "ipd" } }
  );
  console.log(`Updated ${labTokensResult2.modifiedCount} lab tokens (inpatient -> ipd)`);


  console.log("Migration complete.");
  await mongoose.disconnect();
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
