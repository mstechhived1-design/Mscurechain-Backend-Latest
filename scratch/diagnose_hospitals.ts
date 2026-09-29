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
  console.log(`Found ${collections.length} collections.`);

  const results: any[] = [];

  for (const colInfo of collections) {
    const colName = colInfo.name;
    const collection = db.collection(colName);
    const totalDocs = await collection.countDocuments({});

    // Search by ObjectId or String in any common field, or by doing a recursive search/regex search or specific field query.
    // Let's search standard fields first:
    const query = {
      $or: [
        { hospital: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } },
        { hospitalId: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } },
        { hospital_id: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } },
        { hospitals: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } },
        { hospitalIds: { $in: [...targetObjectIds, ...TARGET_HOSPITALS] } }
      ]
    };

    const directMatchCount = await collection.countDocuments(query);

    // Let's do a sample check to see if there are other fields or if the collection itself contains one of the IDs
    // We can fetch a sample of 100 documents to inspect if there's any mention of target hospitals in other fields.
    // Or we can search for one of the target hospital IDs as a value in any field in the entire collection.
    // Let's run a query for each field if directMatchCount is 0, or just report details.
    
    // Also check patient collection specifically
    let patientDetails = "";
    if (colName === "patients" || colName === "patientprofiles" || colName === "users") {
      const sample = await collection.findOne(query);
      if (sample) {
        patientDetails = `Sample keys matching: ${Object.keys(sample).filter(k => {
          const val = JSON.stringify(sample[k]);
          return TARGET_HOSPITALS.some(id => val.includes(id));
        }).join(", ")}`;
      }
    }

    results.push({
      collection: colName,
      totalDocuments: totalDocs,
      matchedDocuments: directMatchCount,
      notes: patientDetails
    });
  }

  console.log("\n--- Diagnostic Results ---");
  console.table(results);

  // Let's do a deep search for any document in any collection that contains any of the target hospital IDs in its string representation.
  console.log("\nChecking for any text match in collections...");
  for (const colInfo of collections) {
    const colName = colInfo.name;
    const collection = db.collection(colName);
    
    // Check if there are documents where any field contains the hospital ID.
    // We can do this by searching for the ID in the document structure.
    // Since MongoDB doesn't easily let us search all fields dynamically for any value without full text search or $where,
    // let's do a $where or retrieve first 1000 docs and check them in memory, or use $or with known fields.
    // But actually, Mongoose schemas define the fields. Let's see if we can find any collections with target IDs.
  }

  await mongoose.disconnect();
  console.log("Disconnected.");
}

run().catch(console.error);
