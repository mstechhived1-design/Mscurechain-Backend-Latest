// Production-Grade Database Configuration
// Features: Connection pooling, retry logic, monitoring, scaling

import dotenv from "dotenv";
import mongoose from "mongoose";
import dns from "dns";

// Force using reliable DNS servers to resolve MongoDB Atlas SRV records
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (err) {
  console.warn("⚠️ [DB] Failed to set custom DNS servers:", err);
}

dotenv.config({ path: ".env" });

const MONGODB_URI = process.env.MONGO_URI;

if (!MONGODB_URI) {
  throw new Error(
    "Please define the MONGO_URI environment variable inside .env",
  );
}

// Cache connection for serverless environments
let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

// ✅ PRODUCTION-GRADE CONNECTION OPTIONS
const connectionOptions = {
  // Connection Pool Settings
  maxPoolSize: 200, // Increased for high concurrency with parallel Promise.all queries
  minPoolSize: 20, // Increased minimum
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 10000, // Reduced to fail faster
  connectTimeoutMS: 10000, // Reduced to fail faster

  // Performance Optimizations
  bufferCommands: false, // Disable mongoose buffering
  autoIndex: process.env.NODE_ENV !== "production", // Don't build indexes in production

  // Retry Logic
  retryWrites: true, // Retry failed writes
  retryReads: true, // Retry failed reads

  // Connection Management
  heartbeatFrequencyMS: 10000, // Heartbeat every 10 seconds
  family: 4, // Use IPv4, skip IPv6 DNS lookups
};

/**
 * Connect to MongoDB with retry logic and monitoring
 */
export async function connectDB() {
  // Return cached connection if available
  if (cached.conn) {
    console.log("✅ [DB] Using cached MongoDB connection");
    return cached.conn;
  }

  // Create new connection if not cached
  if (!cached.promise) {
    let uri = MONGODB_URI as string;

    // Performance: Replace localhost with 127.0.0.1 to avoid IPv6 lookup delays
    if (uri.includes("localhost")) {
      uri = uri.replace("localhost", "127.0.0.1");
    }

    console.log("🔄 [DB] Creating new MongoDB connection");
    console.log(
      `🔗 [DB] Connection string: ${uri.replace(/\/\/.*:.*@/, "//***:***@")}`,
    ); // Hide credentials

    cached.promise = mongoose
      .connect(uri, connectionOptions)
      .then((mongooseInstance) => {
        const conn = mongooseInstance.connection;

        console.log(`✅ [DB] MongoDB Connected: ${conn.host}`);
        console.log(`📊 [DB] Database: ${conn.name}`);
        console.log(`⚡ [DB] Ready State: ${conn.readyState}`);

        // Set up connection monitoring
        setupConnectionMonitoring(conn);

        // Disable debug logging
        mongoose.set("debug", false);

        return mongooseInstance;
      })
      .catch((error) => {
        console.error("❌ [DB] MongoDB connection error:", error.message);
        // Reset promise to allow retry
        cached.promise = null;
        throw error;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e: any) {
    cached.promise = null;
    console.error("❌ [DB] Connection failed:", e.message);

    // Only exit in traditional server mode
    if (process.env.NODE_ENV !== "production" || process.env.VERCEL !== "1") {
      process.exit(1);
    }
    throw e;
  }

  return cached.conn;
}

/**
 * Set up connection monitoring and event handlers
 */
function setupConnectionMonitoring(connection: mongoose.Connection) {
  // Connection events
  connection.on("connected", () => {
    console.log("✅ [DB] Mongoose connected to MongoDB");
  });

  connection.on("error", (err) => {
    console.error("❌ [DB] Mongoose connection error:", err);
  });

  connection.on("disconnected", () => {
    console.warn("⚠️ [DB] Mongoose disconnected from MongoDB");
  });

  connection.on("reconnected", () => {
    console.log("✅ [DB] Mongoose reconnected to MongoDB");
  });

  // Log slow queries (> 100ms)
  if (process.env.NODE_ENV !== "production") {
    // Disabled full debug as it blocks the event loop on high volume
    mongoose.set("debug", false);
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await connection.close();
    console.log("🛑 [DB] MongoDB connection closed through app termination");
    process.exit(0);
  });
}

/**
 * Get connection statistics
 */
export function getDBStats() {
  const conn = mongoose.connection;

  return {
    readyState: conn.readyState,
    host: conn.host,
    name: conn.name,
    collections: Object.keys(conn.collections).length,
    models: Object.keys(conn.models).length,
  };
}

/**
 * Health check for database
 */
export async function checkDBHealth(): Promise<boolean> {
  try {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      // Ping the database
      await mongoose.connection.db.admin().ping();
      return true;
    }
    return false;
  } catch (error) {
    console.error("❌ [DB] Health check failed:", error);
    return false;
  }
}

/**
 * Close database connection
 */
export async function closeDB() {
  if (cached.conn) {
    await cached.conn.connection.close();
    cached.conn = null;
    cached.promise = null;
    console.log("🛑 [DB] MongoDB connection closed");
  }
}

export default connectDB;
