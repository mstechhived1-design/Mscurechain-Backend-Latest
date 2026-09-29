import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:curechain_admin@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function check() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected');
  
  const id = "69d8c065e944e5016c8e1b50";
  
  const user = await mongoose.connection.db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(id) });
  const patient = await mongoose.connection.db.collection('patients').findOne({ _id: new mongoose.Types.ObjectId(id) });
  
  console.log('User found in "users" collection:', !!user);
  if (user) console.log('User data:', user.name, user.mobile, user.role);
  
  console.log('User found in "patients" collection:', !!patient);
  if (patient) console.log('Patient data:', patient.name, patient.mobile, patient.role);

  await mongoose.disconnect();
}

check().catch(console.error);
