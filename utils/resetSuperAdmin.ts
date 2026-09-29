import mongoose from "mongoose";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI!;

async function resetSuperAdmin() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const db = mongoose.connection.db!;
  const collection = db.collection("superadmins");

  const newEmail = "mahe@mstechhive.com";
  const newPassword = "Maheer@123";
  const newMobile = "9182745383";
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Try to find existing super admin
  const existing = await collection.findOne({});
  
  if (existing) {
    // Update the existing record
    await collection.updateOne(
      { _id: existing._id },
      {
        $set: {
          email: newEmail,
          mobile: newMobile,
          password: hashedPassword,
          status: "active",
        },
      }
    );
    console.log(`✅ Super Admin updated:`);
    console.log(`   Old email: ${existing.email}`);
    console.log(`   New email: ${newEmail}`);
  } else {
    // Create new
    await collection.insertOne({
      name: "Super Admin",
      email: newEmail,
      mobile: "9876543210",
      password: hashedPassword,
      role: "super-admin",
      status: "active",
      refreshTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`✅ Super Admin created with email: ${newEmail}`);
  }

  console.log(`   Password: ${newPassword}`);
  await mongoose.disconnect();
  console.log("✅ Done. Disconnected.");
  process.exit(0);
}

resetSuperAdmin().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
