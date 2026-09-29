import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

function sanitizeName(name) {
  if (!name) return "";
  let cleaned = name.trim();
  cleaned = cleaned.replace(/\s*\.+\s*/g, " ").replace(/\s+/g, " ").trim();
  while (/^(dr|dr\.|dr\s+|dr\.\s+)/i.test(cleaned)) {
    cleaned = cleaned.replace(/^(dr|dr\.|dr\s+|dr\.\s+)/i, "").trim();
  }
  return cleaned ? `Dr. ${cleaned}` : "";
}

async function run() {
  const mongoUri = process.env.MONGO_URI || "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";
  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(mongoUri);
  
  const db = mongoose.connection.db;
  if (!db) {
    console.error("DB connection failed");
    return;
  }

  // 1. Clean 'users' collection
  const usersCollection = db.collection("users");
  const users = await usersCollection.find({ role: "doctor" }).toArray();
  console.log(`Found ${users.length} doctors/users.`);
  
  for (const user of users) {
    if (user.name) {
      const cleaned = sanitizeName(user.name);
      if (cleaned !== user.name) {
        console.log(`Updating user ${user._id}: "${user.name}" -> "${cleaned}"`);
        await usersCollection.updateOne({ _id: user._id }, { $set: { name: cleaned } });
      }
    }
  }

  // 2. Clean 'doctors' collection (if it exists)
  const doctorsCollection = db.collection("doctors");
  const doctors = await doctorsCollection.find({}).toArray();
  console.log(`Found ${doctors.length} records in doctors collection.`);
  for (const doctor of doctors) {
    if (doctor.name) {
      const cleaned = sanitizeName(doctor.name);
      if (cleaned !== doctor.name) {
        console.log(`Updating doctor ${doctor._id}: "${doctor.name}" -> "${cleaned}"`);
        await doctorsCollection.updateOne({ _id: doctor._id }, { $set: { name: cleaned } });
      }
    }
  }

  // 3. Clean denormalized names in other collections:
  const collectionsToClean = [
    { name: "appointments", fields: ["doctorName", "suggestedDoctorName"] },
    { name: "invoices", fields: ["doctorName"] },
    { name: "pharmacyorders", fields: ["doctorName"] },
    { name: "pharmacytokens", fields: ["doctorName"] },
    { name: "laborders", fields: ["doctorName", "referredBy"] },
    { name: "labtokens", fields: ["doctorName"] },
    { name: "directlaborders", fields: ["doctorName"] },
    { name: "walkinpatients", fields: ["doctorName"] },
    { name: "ipdadmissions", fields: ["doctorName", "primaryDoctor"] },
    { name: "dischargerecords", fields: ["primaryDoctor", "suggestedDoctorName"] }
  ];

  for (const colInfo of collectionsToClean) {
    try {
      const collection = db.collection(colInfo.name);
      const docs = await collection.find({}).toArray();
      let updatedCount = 0;
      for (const doc of docs) {
        const updateFields = {};
        for (const field of colInfo.fields) {
          const val = doc[field];
          if (val && typeof val === "string") {
            if (val.toLowerCase().startsWith("dr") || val.includes("..") || val.includes(". .")) {
              const cleaned = sanitizeName(val);
              if (cleaned !== val) {
                updateFields[field] = cleaned;
              }
            }
          }
        }
        if (Object.keys(updateFields).length > 0) {
          await collection.updateOne({ _id: doc._id }, { $set: updateFields });
          updatedCount++;
        }
      }
      if (updatedCount > 0) {
        console.log(`Updated ${updatedCount} documents in '${colInfo.name}' collection.`);
      }
    } catch (err) {
      console.warn(`Collection '${colInfo.name}' could not be processed (might not exist): ${err.message}`);
    }
  }

  await mongoose.disconnect();
  console.log("Database cleanup completed successfully!");
}

run().catch(console.error);
