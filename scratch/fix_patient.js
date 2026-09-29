import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function fix() {
    try {
        console.log("Connecting to:", process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000
        });
        console.log("Connected to MongoDB");

        const db = mongoose.connection.db;
        const mrn = "DHO235000412";

        const profile = await db.collection("patientprofiles").findOne({ mrn });
        if (profile) {
            console.log("Found profile, updating...");
            // Set DOB to 6 years ago
            const newDob = new Date();
            newDob.setFullYear(newDob.getFullYear() - 6);
            
            await db.collection("patientprofiles").updateOne(
                { _id: profile._id },
                { $set: { dob: newDob } }
            );

            if (profile.user) {
                await db.collection("patients").updateOne(
                    { _id: profile.user },
                    { $set: { age: 6, ageUnit: "Years", dateOfBirth: newDob } }
                );
            }
            console.log("SUCCESS: Patient updated to 6 Years!");
        } else {
            console.log("ERROR: Patient with MRN DHO235000412 not found.");
        }
    } catch (e) {
        console.error("Script error:", e);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

fix();
