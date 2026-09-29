import mongoose from "mongoose";
import StaffProfile from "../Staff/Models/StaffProfile";
import "dotenv/config";

async function check() {
  try {
    const mongoUri =
      process.env.MONGO_URI || "mongodb://localhost:27017/Multi-Cure";
    await mongoose.connect(mongoUri);
    const profiles = await (StaffProfile.find() as any)
      .unscoped()
      .limit(5)
      .lean();
    console.log(JSON.stringify(profiles, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
