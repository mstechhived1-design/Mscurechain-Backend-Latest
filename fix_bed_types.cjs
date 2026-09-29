require('dotenv').config();
const mongoose = require('mongoose');

const HOSPITAL_ID = '69a7b003c84f8f6e66180872';
const VALID_TYPES = ['emergency', 'general ward', 'vip', 'private', 'icu'];
const DEFAULT_FALLBACK = 'General Ward';

async function fixBedTypes() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        const db = mongoose.connection.db;
        const bedsCollection = db.collection('beds');

        const sampleBed = await bedsCollection.findOne({});
        console.log("Sample bed:", JSON.stringify(sampleBed, null, 2));

        const query = { 
            $or: [
                { hospital: new mongoose.Types.ObjectId(HOSPITAL_ID) },
                { hospitalId: new mongoose.Types.ObjectId(HOSPITAL_ID) },
                { hospital_id: new mongoose.Types.ObjectId(HOSPITAL_ID) }
            ]
        };

        const beds = await bedsCollection.find(query).toArray();
        console.log(`Found ${beds.length} beds total in this hospital.`);

        let updatedCount = 0;

        for (const bed of beds) {
            const currentType = bed.type ? bed.type.trim() : '';
            const typeLower = currentType.toLowerCase();
            
            const isValid = VALID_TYPES.some(t => typeLower === t || typeLower.includes(t));
            
            if (!isValid) {
                console.log(`Updating bed ${bed.bedId} (ID: ${bed._id}) - Invalid Type: "${currentType}" -> Setting to "${DEFAULT_FALLBACK}"`);
                
                await bedsCollection.updateOne(
                    { _id: bed._id },
                    { $set: { type: DEFAULT_FALLBACK } }
                );
                
                updatedCount++;
            }
        }

        console.log(`\nFinished updating bed types. Total beds fixed: ${updatedCount}`);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
    }
}

fixBedTypes();
