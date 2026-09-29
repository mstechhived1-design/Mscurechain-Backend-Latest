import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGO_URI;

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  
  const mrn = "DHO235000412";
  
  const patientProfile = await db.collection("patientprofiles").findOne({ mrn });
  
  if (!patientProfile) {
      console.log("Profile not found for MRN:", mrn);
      
      // Let's search by name to be sure
      const patientByName = await db.collection("patients").findOne({ name: { $regex: /HARRY/i } });
      if (patientByName) {
          console.log("Found patient by name instead:", patientByName);
          
          // Update Patient
          const newDob = new Date();
          newDob.setFullYear(newDob.getFullYear() - 6);
          
          await db.collection("patients").updateOne(
              { _id: patientByName._id },
              { $set: { age: 6, ageUnit: "Years", dateOfBirth: newDob } }
          );
          console.log("Patient age updated to 6 Years.");
          
          // Find their profile and update DOB
          const profile = await db.collection("patientprofiles").findOne({ user: patientByName._id });
          if (profile) {
              await db.collection("patientprofiles").updateOne(
                  { _id: profile._id },
                  { $set: { dob: newDob } }
              );
              console.log("Patient Profile DOB updated.");
          }
      }
      process.exit(0);
      return;
  }
  
  console.log("Patient Profile Found:", patientProfile);
  
  const newDob = new Date();
  newDob.setFullYear(newDob.getFullYear() - 6); // Make them 6 years old

  // Update Profile DOB
  await db.collection("patientprofiles").updateOne(
      { _id: patientProfile._id },
      { $set: { dob: newDob } }
  );
  
  // Update Global Patient
  if (patientProfile.user) {
    await db.collection("patients").updateOne(
        { _id: patientProfile.user },
        { $set: { age: 6, ageUnit: "Years", dateOfBirth: newDob } }
    );
    console.log("Patient age updated to 6 Years.");
  }

  console.log("Update completed successfully!");
  process.exit(0);
}

run();
