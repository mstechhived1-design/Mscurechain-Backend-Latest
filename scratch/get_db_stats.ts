import mongoose from "mongoose";

const MONGO_URI = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";
const FREE_TIER_LIMIT_MB = 512; // MongoDB Atlas M0 Free Tier limit in MB

async function run() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected successfully.");

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("DB connection not initialized");
  }

  // Get DB stats
  console.log("Fetching database stats...");
  const stats = await db.command({ dbStats: 1 });

  const toKB = (bytes: number) => (bytes / 1024).toFixed(2) + " KB";
  const toMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2) + " MB";

  const storageBytes = stats.storageSize || 0;
  const indexBytes = stats.indexSize || 0;
  const totalBytes = stats.totalSize || (storageBytes + indexBytes);
  const totalMB = totalBytes / (1024 * 1024);

  const remainingMB = FREE_TIER_LIMIT_MB - totalMB;
  const usagePercentage = (totalMB / FREE_TIER_LIMIT_MB) * 100;

  console.log("\n=============================================");
  console.log("       MONGODB ATLAS M0 FREE TIER STATS      ");
  console.log("=============================================");
  console.log(`Database Name:     ${stats.db}`);
  console.log(`Collections:       ${stats.collections}`);
  console.log(`Total Documents:   ${stats.objects}`);
  console.log(`Avg Document Size: ${(stats.avgObjSize || 0).toFixed(2)} Bytes`);
  console.log("---------------------------------------------");
  console.log(`Logical Data Size: ${toMB(stats.dataSize)} (${toKB(stats.dataSize)})`);
  console.log(`Storage Size:      ${toMB(storageBytes)} (${toKB(storageBytes)})`);
  console.log(`Index Size:        ${toMB(indexBytes)} (${toKB(indexBytes)})`);
  console.log("---------------------------------------------");
  console.log(`Total Occupied:    ${totalMB.toFixed(2)} MB`);
  console.log(`Free Tier Limit:   ${FREE_TIER_LIMIT_MB} MB`);
  console.log(`Remaining Space:   ${remainingMB.toFixed(2)} MB`);
  console.log(`Space Usage %:     ${usagePercentage.toFixed(2)}%`);
  console.log("=============================================");

  await mongoose.disconnect();
  console.log("Disconnected.");
}

run().catch(console.error);
