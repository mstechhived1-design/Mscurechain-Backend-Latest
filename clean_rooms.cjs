require('dotenv').config();
const mongoose = require('mongoose');

const HOSPITAL_ID = '69a7b003c84f8f6e66180872';
const BAD_ROOMS = ['mohammed harsha', 'karthik', 'manohar', 'shaik saif', 'nidhii'];

async function cleanRooms() {
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

        let deletedCount = 0;

        for (const room of rooms) {
            const roomIdStr = room.roomId ? room.roomId.trim().toLowerCase() : '';
            if (BAD_ROOMS.includes(roomIdStr)) {
                console.log(`Deleting invalid room: ${room.roomId} (ID: ${room._id})`);
                await roomsCollection.deleteOne({ _id: room._id });
                deletedCount++;
            }
        }

        console.log(`\nFinished cleaning rooms. Total deleted: ${deletedCount}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
    }
}

cleanRooms();
