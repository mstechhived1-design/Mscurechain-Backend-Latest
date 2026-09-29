import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:curechain_admin@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function check() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected');
  
  const Appointment = mongoose.model('Appointment', new mongoose.Schema({}, { strict: false }), 'appointments');

  const now = new Date();
  const start = new Date(now); start.setHours(0,0,0,0);
  const end = new Date(now); end.setHours(23,59,59,999);

  const apps = await Appointment.find({
    date: { $gte: start, $lte: end },
    status: { $nin: ["cancelled", "rejected", "completed"] }
  }).populate("patient", "name mobile").lean();

  console.log(`Found ${apps.length} active appointments today:`);
  apps.forEach((a: any) => {
    console.log(`- ID: ${a._id}, Patient: ${a.patient?.name} (${a.patient?.mobile || a.patient?._id}), Doctor: ${a.doctor}, Status: ${a.status}`);
  });

  await mongoose.disconnect();
}

check().catch(console.error);
