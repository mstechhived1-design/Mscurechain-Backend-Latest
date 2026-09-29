/**
 * Ultimate robust MongoDB indexing script
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;

async function safeCreateIndex(db, collectionName, indexSpec, options) {
    try {
        const indexes = await db.collection(collectionName).listIndexes().toArray();

        // Check if an index with identical keys exists
        const identicalKeyIndex = indexes.find(idx => {
            const keys = Object.keys(idx.key);
            const specKeys = Object.keys(indexSpec);
            if (keys.length !== specKeys.length) return false;
            return keys.every(k => idx.key[k] === indexSpec[k]);
        });

        if (identicalKeyIndex) {
            if (identicalKeyIndex.name === options.name) {
                console.log(`✅ Index ${options.name} already exists with correct keys.`);
                return;
            } else {
                console.log(`⚠️ Index with identical keys exists with name ${identicalKeyIndex.name}. Dropping it...`);
                await db.collection(collectionName).dropIndex(identicalKeyIndex.name);
            }
        }

        // Also check if an index with the same name exists but different keys
        const sameNameIndex = indexes.find(idx => idx.name === options.name);
        if (sameNameIndex) {
            console.log(`⚠️ Index with name ${options.name} exists with different keys. Dropping it...`);
            await db.collection(collectionName).dropIndex(options.name);
        }

        console.log(`Creating index ${options.name} on ${collectionName}...`);
        await db.collection(collectionName).createIndex(indexSpec, options);
        console.log(`✅ Index ${options.name} created successfully.`);
    } catch (error) {
        console.error(`❌ Error processing index ${options.name} on ${collectionName}:`, error.message);
    }
}

async function createIndexes() {
    try {
        await mongoose.connect(MONGO_URI);
        const db = mongoose.connection.db;

        await safeCreateIndex(db, 'laborders',
            { hospital: 1, status: 1, createdAt: -1 },
            { name: "idx_lab_hospital_status_created" }
        );
        await safeCreateIndex(db, 'laborders',
            { patient: 1, createdAt: -1 },
            { name: "idx_lab_patient_created" }
        );
        await safeCreateIndex(db, 'laborders',
            { status: 1, paymentStatus: 1, createdAt: -1 },
            { name: "idx_lab_status_payment_created" }
        );
        await safeCreateIndex(db, 'labtests',
            { isActive: 1, departmentId: 1 },
            { name: "idx_labtest_active_dept" }
        );
        await safeCreateIndex(db, 'labtests',
            { isActive: 1, departmentIds: 1 },
            { name: "idx_labtest_active_depts" }
        );
        await safeCreateIndex(db, 'labtests',
            { testName: "text", name: "text", testCode: "text" },
            { name: "idx_labtest_search" }
        );
        await safeCreateIndex(db, 'departments',
            { name: 1, isActive: 1 },
            { name: "idx_dept_name_active" }
        );

        console.log('\n🚀 Lab performance tuning complete.');
        process.exit(0);
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

createIndexes();
