// Database Indexes - Optimizes query performance
// Run this once to create all necessary indexes

import mongoose from "mongoose";
import connectDB from "./db.js";

/**
 * Create all database indexes for optimal performance
 */
export async function createDatabaseIndexes() {
  console.log("🔧 [DB] Creating database indexes...");

  try {
    await connectDB();
    const db = mongoose.connection.db;

    if (!db) {
      throw new Error("❌ [DB] Database connection not established");
    }

    const createCollIndexes = async (name: string, indexes: any[]) => {
      try {
        // Check if collection exists first to avoid error on some versions
        const colls = await db.listCollections({ name }).toArray();
        if (colls.length === 0) {
          // Pre-create collection to ensure it exists
          await db.createCollection(name);
        }
        await db.collection(name).createIndexes(indexes);
        console.log(`✅ [DB] Indexes created for: ${name}`);
      } catch (err: any) {
        if (err.code === 85 || err.code === 86) {
          console.warn(
            `⚠️ [DB] Index conflict in ${name}, skipping: ${err.message}`,
          );
        } else {
          console.error(
            `❌ [DB] Failed to create indexes for ${name}:`,
            err.message,
          );
        }
      }
    };

    // ✅ USER COLLECTION INDEXES
    await createCollIndexes("users", [
      { key: { email: 1 }, unique: true, sparse: true },
      { key: { mobile: 1 }, unique: true, sparse: true },
      { key: { role: 1 } },
      { key: { hospital: 1, role: 1, status: 1 } },
      { key: { status: 1 } },
      { key: { createdAt: -1 } },
    ]);

    // ✅ APPOINTMENTS
    await createCollIndexes("appointments", [
      { key: { hospital: 1, date: -1, status: 1 } },
      { key: { doctor: 1, date: -1, status: 1 } },
      { key: { hospital: 1, createdAt: -1 } },
      { key: { doctor: 1, createdAt: -1 } },
      { key: { patient: 1, date: -1 } },
      { key: { appointmentId: 1 }, unique: true },
      { key: { mrn: 1 } },
    ]);

    // ✅ PRESCRIPTIONS
    await createCollIndexes("prescriptions", [
      { key: { patient: 1, createdAt: -1 } },
      { key: { doctor: 1, createdAt: -1 } },
      { key: { hospital: 1, createdAt: -1 } },
      { key: { hospital: 1, followUpDate: 1 } },
      { key: { appointment: 1 } },
    ]);

    // ✅ IPD ADMISSIONS & FLOW
    await createCollIndexes("ipdadmissions", [
      { key: { admissionId: 1 }, unique: true },
      { key: { patient: 1, hospital: 1, status: 1 } },
      { key: { hospital: 1, status: 1 } },
      { key: { admissionDate: -1 } },
    ]);

    await createCollIndexes("clinicalnotes", [
      { key: { admission: 1, createdAt: -1 } },
      { key: { patient: 1, createdAt: -1 } },
      { key: { author: 1 } },
    ]);

    await createCollIndexes("medicationrecords", [
      { key: { admission: 1, timestamp: -1 } },
      { key: { patient: 1, timestamp: -1 } },
      { key: { status: 1 } },
    ]);

    await createCollIndexes("beds", [
      { key: { hospital: 1, status: 1 } },
      { key: { bedId: 1 }, unique: true },
      { key: { ward: 1, status: 1 } },
    ]);

    // ✅ VITALS MONITORING
    await createCollIndexes("vitalsrecords", [
      { key: { patient: 1, createdAt: -1 } },
      { key: { admission: 1, createdAt: -1 } },
    ]);

    await createCollIndexes("vitalsalerts", [
      { key: { hospital: 1, status: 1 } },
      { key: { assignedDoctor: 1, status: 1 } },
      { key: { patient: 1, status: 1 } },
      { key: { createdAt: -1 } },
    ]);

    // ✅ LAB SYSTEM
    await createCollIndexes("laborders", [
      { key: { hospital: 1, status: 1, createdAt: -1 } },
      { key: { patient: 1, createdAt: -1 } },
      { key: { doctor: 1, createdAt: -1 } },
      { key: { status: 1 } },
    ]);

    // ✅ QUALITY & AUDIT
    await createCollIndexes("qualityindicators", [
      { key: { hospitalId: 1, status: 1 } },
      { key: { name: 1, hospitalId: 1 } },
    ]);

    await createCollIndexes("qualityactions", [
      { key: { hospitalId: 1, status: 1 } },
      { key: { indicatorId: 1 } },
      { key: { isClosed: 1 } },
    ]);

    // ✅ SUPPORT & MESSAGING
    await createCollIndexes("supportrequests", [
      { key: { userId: 1, status: 1 } },
      { key: { status: 1, createdAt: -1 } },
      { key: { type: 1 } },
    ]);

    await createCollIndexes("messages", [
      { key: { sender: 1, recipient: 1, createdAt: -1 } },
      { key: { recipient: 1, isRead: 1 } },
    ]);

    // ✅ INCIDENT REPORTING
    await createCollIndexes("incidents", [
      { key: { incidentId: 1 }, unique: true },
      { key: { reportedBy: 1 } },
      { key: { status: 1, severity: 1 } },
      { key: { department: 1 } },
    ]);

    // ✅ STAFF & DOCTOR PROFILES
    await createCollIndexes("doctorprofiles", [
      { key: { user: 1 }, unique: true },
      { key: { hospital: 1 } },
      { key: { specialties: 1 } },
    ]);

    await createCollIndexes("staffprofiles", [
      { key: { user: 1 }, unique: true },
      { key: { hospital: 1, status: 1 } },
    ]);

    await createCollIndexes("patientprofiles", [
      { key: { user: 1 }, unique: true },
      { key: { mrn: 1 }, unique: true },
      { key: { hospital: 1 } },
    ]);

    // ✅ LEAVE MANAGEMENT
    await createCollIndexes("leaves", [
      { key: { requester: 1, status: 1 } },
      { key: { hospital: 1, status: 1 } },
      { key: { startDate: 1, endDate: 1 } },
    ]);

    // ✅ INVENTORY & PHARMA
    await createCollIndexes("pharmaproducts", [
      { key: { hospital: 1, status: 1 } },
      { key: { name: "text", category: "text" } },
      { key: { stockLevel: 1 } },
    ]);

    // ✅ FINANCE & PAYROLL
    await createCollIndexes("transactions", [
      { key: { hospital: 1, createdAt: -1 } },
      { key: { status: 1, type: 1 } },
      { key: { amount: 1 } },
    ]);

    await createCollIndexes("payrolls", [
      { key: { hospital: 1, month: 1, year: 1 } },
      { key: { user: 1, month: 1, year: 1 } },
      { key: { status: 1 } },
    ]);

    // ✅ ATTENDANCE
    await createCollIndexes("attendances", [
      { key: { user: 1, date: 1 }, unique: true },
      { key: { hospital: 1, date: -1, status: 1 } },
    ]);

    // ✅ DISCHARGE RECORDS
    await createCollIndexes("dischargerecords", [
      { key: { mrn: 1 } },
      { key: { patientName: 1 } },
      { key: { createdAt: -1 } },
    ]);

    await createCollIndexes("pendingdischarges", [
      { key: { hospital: 1, status: 1 } },
      { key: { mrn: 1 } },
      { key: { admissionId: 1 }, unique: true },
    ]);

    console.log("🎉 [DB] All Covering Indexes created for all System Modules!");

    // Show stats
    await getIndexStats();
  } catch (error) {
    console.error("❌ [DB] Error creating indexes:", error);
    throw error;
  }
}

/**
 * Get index statistics for all collections
 */
async function getIndexStats() {
  const db = mongoose.connection.db;
  if (!db) return {};

  try {
    const collections = await db.listCollections().toArray();
    const stats: any = {};

    for (const coll of collections) {
      try {
        const indexes = await db.collection(coll.name).listIndexes().toArray();
        stats[coll.name] = {
          count: indexes.length,
          indexes: indexes.map((idx: any) => idx.name),
        };
      } catch (e) {}
    }
    return stats;
  } catch (e) {
    return { error: "Could not fetch stats" };
  }
}

/**
 * Drop all indexes (use with caution!)
 */
export async function dropAllIndexes() {
  console.warn("⚠️ [DB] Dropping all indexes except _id...");

  const db = mongoose.connection.db;
  if (!db) return;

  try {
    const collections = await db.listCollections().toArray();
    for (const coll of collections) {
      try {
        await db.collection(coll.name).dropIndexes();
        console.log(`🗑️ [DB] Dropped indexes for ${coll.name}`);
      } catch (e) {
        // Ignore if collection has no indexes
      }
    }
  } catch (e) {
    console.error("Error dropping indexes:", e);
  }
}

// Export for use in scripts
export default createDatabaseIndexes;
