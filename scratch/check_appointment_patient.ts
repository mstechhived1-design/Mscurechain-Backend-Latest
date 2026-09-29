import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:curechain_admin@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function checkAppointments() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');
  
  const Appointment = mongoose.model('Appointment', new mongoose.Schema({}, { strict: false }), 'appointments');
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  const Patient = mongoose.model('Patient', new mongoose.Schema({}, { strict: false }), 'patients');
  const PatientProfile = mongoose.model('PatientProfile', new mongoose.Schema({}, { strict: false }), 'patientprofiles');

  // Get sample appointments
  const apps = await Appointment.find().limit(5).lean();
  
  console.log('\n=== Sample Appointments ===');
  for (const app of apps) {
    console.log(`\nAppointment ID: ${app._id}`);
    console.log(`  patient field: ${app.patient}`);
    console.log(`  globalPatientId: ${app.globalPatientId}`);
    console.log(`  hospital: ${app.hospital}`);
    console.log(`  patientDetails: ${JSON.stringify(app.patientDetails)}`);
    console.log(`  mrn: ${app.mrn}`);
    
    // Check what this patient ID is
    const patientId = app.patient || app.globalPatientId;
    if (patientId) {
      // Try as User
      const user = await User.findById(patientId).lean();
      if (user) {
        console.log(`  -> Found in User collection: ${user.name}, mobile: ${user.mobile}`);
      } else {
        // Try as Patient
        const patient = await Patient.findById(patientId).lean();
        if (patient) {
          console.log(`  -> Found in Patient collection: ${patient.name}, mobile: ${patient.mobile}`);
        } else {
          console.log(`  -> NOT found in User or Patient collection`);
        }
      }
      
      // Check PatientProfile
      if (app.hospital) {
        const profile = await PatientProfile.findOne({ user: patientId, hospital: app.hospital }).lean();
        if (profile) {
          console.log(`  -> Found Profile: mrn: ${profile.mrn}, gender: ${profile.gender}`);
        } else {
          console.log(`  -> No profile found for user:${patientId}, hospital:${app.hospital}`);
        }
      }
    }
  }

  await mongoose.disconnect();
  console.log('\nDone');
}

checkAppointments().catch(console.error);