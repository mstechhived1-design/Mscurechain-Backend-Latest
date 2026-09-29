import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:curechain_admin@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function checkAllPatientProfiles() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');
  
  const PatientProfile = mongoose.model('PatientProfile', new mongoose.Schema({}, { strict: false }), 'patientprofiles');
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');

  // Check ALL profiles
  const profiles = await PatientProfile.find().limit(20).lean();
  
  console.log(`\n=== ALL PatientProfiles ===`);
  console.log(`Found ${profiles.length} total profiles`);
  
  if (profiles.length > 0) {
    for (const p of profiles) {
      console.log(`\nProfile ID: ${p._id}`);
      console.log(`  user: ${p.user}`);
      console.log(`  hospital: ${p.hospital}`);
      console.log(`  mrn: ${p.mrn}`);
      console.log(`  gender: ${p.gender}`);
      
      // Get user name
      const user = await User.findById(p.user).lean();
      console.log(`  -> User: ${user?.name || 'NOT FOUND'}`);
    }
  }

  await mongoose.disconnect();
  console.log('\nDone');
}

checkAllPatientProfiles().catch(console.error);