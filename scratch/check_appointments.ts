
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/curechain';

async function checkData() {
  await mongoose.connect(MONGO_URI);
  const Appointment = mongoose.connection.collection('appointments');
  const sample = await Appointment.findOne({ patient: null });
  console.log('Sample appointment with null patient:', JSON.stringify(sample, null, 2));
  
  const sampleWithPatients = await Appointment.findOne({ patients: { $exists: true } });
  console.log('Sample appointment with patients field:', JSON.stringify(sampleWithPatients, null, 2));

  await mongoose.disconnect();
}

checkData();
