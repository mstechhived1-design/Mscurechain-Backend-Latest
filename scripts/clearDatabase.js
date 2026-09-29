import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("❌ MONGO_URI not found in .env file");
    process.exit(1);
}

async function clearDatabase() {
    try {
        console.log("🔌 Connecting to MongoDB...");
        await mongoose.connect(MONGO_URI);
        console.log("✅ Connected to MongoDB Atlas — Database: curechain\n");

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();

        if (collections.length === 0) {
            console.log("ℹ️  No collections found. Database is already empty.");
            process.exit(0);
        }

        console.log(`📦 Found ${collections.length} collections to drop:\n`);
        collections.forEach((col) => console.log(`   - ${col.name}`));
        console.log("\n🗑️  Dropping all collections...\n");

        for (const collection of collections) {
            await db.dropCollection(collection.name);
            console.log(`   ✅ Dropped: ${collection.name}`);
        }

        console.log("\n🎉 ALL COLLECTIONS DROPPED SUCCESSFULLY.");
        console.log("📭 Database 'curechain' is now completely empty.\n");
    } catch (err) {
        console.error("❌ Error clearing database:", err);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log("🔌 Disconnected from MongoDB.");
        process.exit(0);
    }
}

clearDatabase();
