import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  const mongoUri = process.env.MONGO_URI || "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";
  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(mongoUri);
  
  const db = mongoose.connection.db;
  if (!db) {
    console.error("DB connection failed");
    return;
  }
  
  // Find all users in the 'users' collection
  const usersCollection = db.collection("users");
  const users = await usersCollection.find({}).toArray();
  console.log(`Found ${users.length} users in database.`);
  
  for (const user of users) {
    if (user.name && (user.name.includes("..") || user.name.includes(". .") || user.name.includes(".  ."))) {
      let cleanedName = user.name;
      cleanedName = cleanedName.replace(/\s*\.+\s*/g, " ").replace(/\s+/g, " ").trim();
      
      if (cleanedName.toUpperCase().startsWith("DR ")) {
         cleanedName = "DR. " + cleanedName.slice(3).trim();
      } else if (cleanedName.toUpperCase().startsWith("DR.")) {
         cleanedName = "DR. " + cleanedName.replace(/^DR\.\s*/i, "").trim();
      }
      
      console.log(`Updating User ID ${user._id}: "${user.name}" -> "${cleanedName}"`);
      await usersCollection.updateOne({ _id: user._id }, { $set: { name: cleanedName } });
    }
  }
  
  // Also check the 'doctors' collection
  const doctorsCollection = db.collection("doctors");
  const doctors = await doctorsCollection.find({}).toArray();
  console.log(`Found ${doctors.length} doctors in database.`);
  
  for (const doctor of doctors) {
    if (doctor.name && (doctor.name.includes("..") || doctor.name.includes(". .") || doctor.name.includes(".  ."))) {
      let cleanedName = doctor.name;
      cleanedName = cleanedName.replace(/\s*\.+\s*/g, " ").replace(/\s+/g, " ").trim();
      
      if (cleanedName.toUpperCase().startsWith("DR ")) {
         cleanedName = "DR. " + cleanedName.slice(3).trim();
      } else if (cleanedName.toUpperCase().startsWith("DR.")) {
         cleanedName = "DR. " + cleanedName.replace(/^DR\.\s*/i, "").trim();
      }
      
      console.log(`Updating Doctor ID ${doctor._id}: "${doctor.name}" -> "${cleanedName}"`);
      await doctorsCollection.updateOne({ _id: doctor._id }, { $set: { name: cleanedName } });
    }
  }
  
  await mongoose.disconnect();
  console.log("Disconnected from DB. Done!");
}

run().catch(console.error);
