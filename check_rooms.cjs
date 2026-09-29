require('dotenv').config();
const mongoose = require('mongoose');

const HOSPITAL_ID = '69a7b003c84f8f6e66180872';

async function checkRooms() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        const db = mongoose.connection.db;
        const roomsCollection = db.collection('rooms');

        const query = { 
            $or: [
                { hospital: new mongoose.Types.ObjectId(HOSPITAL_ID) },
                { hospitalId: new mongoose.Types.ObjectId(HOSPITAL_ID) },
                { hospital_id: new mongoose.Types.ObjectId(HOSPITAL_ID) }
            ]
        };

        const rooms = await roomsCollection.find(query).toArray();
        console.log(`Found ${rooms.length} rooms total in this hospital.`);

        const roomIds = rooms.map(r => r.roomId);
        console.log("Room IDs:", roomIds);
        
        // Also log one room document to see the exact structure
        if (rooms.length > 0) {
            console.log("Sample room document:", JSON.stringify(rooms[0], null, 2));
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
    }
}

checkRooms();
