
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const dropIndex = async () => {
    try {
        const uri = process.env.MONGO_URI;
        if (!uri) throw new Error('MONGO_URI not found in .env');

        await mongoose.connect(uri);
        console.log('Connected to MongoDB');

        const collection = mongoose.connection.collection('pharmainvoices');

        // Drop the problematic global unique index
        try {
            await collection.dropIndex('invoiceNo_1');
            console.log('Successfully dropped index: invoiceNo_1');
        } catch (err) {
            console.log('Index invoiceNo_1 not found or already dropped.');
        }

        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
};

dropIndex();
