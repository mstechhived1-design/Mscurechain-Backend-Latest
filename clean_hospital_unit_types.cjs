require('dotenv').config();
const mongoose = require('mongoose');

const HOSPITAL_ID = '69a7b003c84f8f6e66180872';
const VALID_TYPES = ['emergency', 'general ward', 'vip', 'private', 'icu'];

async function cleanHospitalUnitTypes() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        const db = mongoose.connection.db;
        const hospitalsCollection = db.collection('hospitals');

        const hospitalIdObj = new mongoose.Types.ObjectId(HOSPITAL_ID);
        const hospital = await hospitalsCollection.findOne({ _id: hospitalIdObj });

        if (!hospital) {
            console.log("Hospital not found!");
            return;
        }

        console.log("Original unitTypes:", hospital.unitTypes);

        if (hospital.unitTypes && Array.isArray(hospital.unitTypes)) {
            // Keep only valid types
            const newUnitTypes = hospital.unitTypes.filter(type => {
                const lowerType = type.trim().toLowerCase();
                return VALID_TYPES.some(valid => lowerType === valid || lowerType.includes(valid));
            });

            console.log("New filtered unitTypes:", newUnitTypes);

            await hospitalsCollection.updateOne(
                { _id: hospitalIdObj },
                { $set: { unitTypes: newUnitTypes } }
            );

            console.log("Successfully updated hospital unitTypes.");
        } else {
            console.log("No unitTypes array found on this hospital.");
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
    }
}

cleanHospitalUnitTypes();
