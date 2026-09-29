import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:curechain_admin@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function checkAllAppointments() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');
  
  const db = mongoose.connection.db;
  const hospitalId = new mongoose.Types.ObjectId('69e720e5059b501407bb88d4');
  
  // Get appointments
  const apps = await db.collection('appointments').find({ hospital: hospitalId }).limit(5).toArray();
  
  console.log(`\n=== Found ${apps.length} appointments for hospital ${hospitalId} ===\n`);
  
  for (const app of apps) {
    console.log(`Appointment: ${app._id}`);
    console.log(`  patient: ${app.patient}`);
    console.log(`  globalPatientId: ${app.globalPatientId}`);
    console.log(`  patientDetails: ${JSON.stringify(app.patientDetails)}`);
    console.log(`  mrn in appointment: ${app.mrn}`);
    
    const searchId = app.patient || app.globalPatientId;
    
    // Check User
    const userDoc = await db.collection('users').findOne({ _id: searchId });
    console.log(`  User: ${userDoc ? userDoc.name + ' (' + userDoc.mobile + ')' : 'NOT FOUND'}`);
    
    // Check PatientProfile for this hospital
    const profileDoc = await db.collection('patientprofiles').findOne({ user: searchId, hospital: hospitalId });
    console.log(`  Profile: ${profileDoc ? 'MRN=' + profileDoc.mrn + ', gender=' + profileDoc.gender : 'NOT FOUND'}`);
    
    // Check Patient collection
    const patientDoc = await db.collection('patients').findOne({ _id: searchId });
    console.log(`  Patient: ${patientDoc ? patientDoc.name : 'NOT FOUND'}`);
    
    console.log('');
  }

  await mongoose.disconnect();
  console.log('Done');
}

checkAllAppointments().catch(console.error);