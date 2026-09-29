const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const db = mongoose.connection.db;
    const hospital = await db.collection('hospitals').findOne({ _id: new mongoose.Types.ObjectId("69a7b003c84f8f6e66180872") });
    console.log("Hospital ID: 69a7b003c84f8f6e66180872");
    console.log("opdFollowUpDays:", hospital.opdFollowUpDays);
    console.log("ipdFollowUpDays:", hospital.ipdFollowUpDays);
    process.exit(0);
}).catch(console.error);
