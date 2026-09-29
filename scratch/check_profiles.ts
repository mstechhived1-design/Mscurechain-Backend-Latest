import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:curechain_admin@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function checkPatientProfiles() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');
  
  const PatientProfile = mongoose.model('PatientProfile', new mongoose.Schema({}, { strict: false }), 'patientprofiles');
  const hospitalId = '69e720e5059b501407bb88d4';

  // Check all profiles for this hospital
  const profiles = await PatientProfile.find({ hospital: hospitalId }).limit(10).lean();
  
  console.log(`\n=== PatientProfiles for hospital ${hospitalId} ===`);
  console.log(`Found ${profiles.length} profiles`);
  
  profiles.forEach((p: any) => {
    console.log(`\nProfile ID: ${p._id}`);
    console.log(`  user: ${p.user}`);
    console.log(`  mrn: ${p.mrn}`);
    console.log(`  gender: ${p.gender}`);
    console.log(`  dob: ${p.dob}`);
  });

  await mongoose.disconnect();
  console.log('\nDone');
}

checkPatientProfiles().catch(console.error);