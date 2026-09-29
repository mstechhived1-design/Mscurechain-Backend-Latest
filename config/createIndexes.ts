#!/usr/bin/env tsx
// Script to create database indexes
import createDatabaseIndexes from './indexes.js';
import mongoose from 'mongoose';

async function run() {
    try {
        await createDatabaseIndexes();
        await mongoose.connection.close();
        console.log('✅ [DB] Index creation complete. Connection closed.');
        process.exit(0);
    } catch (error) {
        console.error('❌ [DB] Failed to create indexes:', error);
        process.exit(1);
    }
}

run();
