import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:curechain_admin@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function checkPatientInPatientsCollection() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');
  
  const db = mongoose.connection.db;
  const hospitalId = new mongoose.Types.ObjectId('69e720e5059b501407bb88d4');
  const searchId = new mongoose.Types.ObjectId('69e72109059b501407bb8a04');
  
  // Direct MongoDB queries to bypass Mongoose plugins
  console.log(`\n=== Checking patient ID: ${searchId} ===\n`);
  
  // 1. Check in patients collection
  console.log('1. Checking patients collection...');
  const patientDoc = await db.collection('patients').findOne({ _id: searchId });
  if (patientDoc) {
    console.log(`   FOUND in patients: _id=${patientDoc._id}, name=${patientDoc.name}, mobile=${patientDoc.mobile}`);
  } else {
    console.log(`   NOT found in patients collection`);
  }
  
  // 2. Check in users collection
  console.log('\n2. Checking users collection...');
  const userDoc = await db.collection('users').findOne({ _id: searchId });
  if (userDoc) {
    console.log(`   FOUND in users: _id=${userDoc._id}, name=${userDoc.name}, mobile=${userDoc.mobile}`);
  } else {
    console.log(`   NOT found in users collection`);
  }
  
  // 3. Check PatientProfile for this hospital
  console.log('\n3. Checking patientprofiles for this hospital...');
  const profileDoc = await db.collection('patientprofiles').findOne({ user: searchId, hospital: hospitalId });
  if (profileDoc) {
    console.log(`   FOUND: _id=${profileDoc._id}, mrn=${profileDoc.mrn}, gender=${profileDoc.gender}, hospital=${profileDoc.hospital}`);
  } else {
    console.log(`   NOT found for hospital ${hospitalId}`);
  }
  
  // 4. Check ANY PatientProfile with this user
  console.log('\n4. Checking any patientprofiles with this user...');
  const anyProfile = await db.collection('patientprofiles').findOne({ user: searchId });
  if (anyProfile) {
    console.log(`   FOUND: hospital=${anyProfile.hospital}, mrn=${anyProfile.mrn}`);
  } else {
    console.log(`   No profile found with user=${searchId}`);
  }

  // Check what hospitals are in patientProfiles for this user
  console.log('\n5. All patientprofiles for this user...');
  const allProfiles = await db.collection('patientprofiles').find({ user: searchId }).toArray();
  console.log(`   Found ${allProfiles.length} profiles`);
  allProfiles.forEach((p: any) => {
    console.log(`   - hospital: ${p.hospital}, mrn: ${p.mrn}`);
  });

  await mongoose.disconnect();
  console.log('\nDone');
}

checkPatientInPatientsCollection().catch(console.error);