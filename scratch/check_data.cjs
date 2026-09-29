
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    const Appointment = mongoose.connection.collection('appointments');
    const appt = await Appointment.findOne({ hospital: new mongoose.Types.ObjectId("67b0258169b35b62b083d06b") }); // Use a known hospital ID if possible or just any
    console.log("Appointment Sample:", JSON.stringify(appt, null, 2));
    
    const Transaction = mongoose.connection.collection('transactions');
    const tx = await Transaction.findOne({ hospital: new mongoose.Types.ObjectId("67b0258169b35b62b083d06b") });
    console.log("Transaction Sample:", JSON.stringify(tx, null, 2));

    await mongoose.disconnect();
}

check();
