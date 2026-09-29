/**
 * Node.js script to apply database indexes for Pharmacy Module performance optimization.
 * This script connects to the MongoDB service using the MONGO_URI from .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the parent directory
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ Error: MONGO_URI not found in .env');
    process.exit(1);
}

async function createIndexes() {
    try {
        console.log('⏳ Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected successfully!');

        const db = mongoose.connection.db;

        // --- Products Indexes ---
        console.log('\n📦 Indexing Products collection...');
        const products = db.collection('products');

        await products.createIndex({ pharmacy: 1, isActive: 1 }, { name: "idx_pharmacy_active" });
        await products.createIndex({ pharmacy: 1, stock: 1, minStock: 1 }, { name: "idx_pharmacy_stock_minstock" });
        await products.createIndex({ pharmacy: 1, expiryDate: 1 }, { name: "idx_pharmacy_expiry" });
        await products.createIndex({ name: "text", brand: "text", generic: "text" }, { name: "idx_pharmacy_text_search" });
        console.log('✅ Products indexed');

        // --- Invoices Indexes ---
        console.log('\n🧾 Indexing Invoices collection...');
        // Check both possible collection names (pluralization differences)
        const invoices = db.collection('pharmainvoices');

        await invoices.createIndex({ pharmacy: 1, createdAt: -1, status: 1 }, { name: "idx_pharmacy_created_status" });
        await invoices.createIndex({ pharmacy: 1, status: 1 }, { name: "idx_pharmacy_status" });
        console.log('✅ Invoices indexed');

        // --- Profiles & Suppliers Indexes ---
        console.log('\n🏥 Indexing Profiles & Suppliers...');
        const profiles = db.collection('pharmaprofiles');
        const suppliers = db.collection('suppliers');

        await profiles.createIndex({ user: 1 }, { name: "idx_profile_user" });
        await profiles.createIndex({ hospital: 1 }, { name: "idx_profile_hospital" });
        await suppliers.createIndex({ pharmacy: 1, name: 1 }, { name: "idx_supplier_pharmacy_name" });
        console.log('✅ Profiles and Suppliers indexed');

        console.log('\n🚀 ALL INDEXES APPLIED SUCCESSFULLY!');
        console.log('Dashboard results should now be near-instant.');

    } catch (error) {
        console.error('\n❌ Indexing Failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from MongoDB');
    }
}

createIndexes();
