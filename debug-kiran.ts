import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:curechain_admin@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function check() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected');
  
  const Patient = mongoose.model('Patient', new mongoose.Schema({}, { strict: false }), 'patients');
  const PatientProfile = mongoose.model('PatientProfile', new mongoose.Schema({}, { strict: false }), 'patientprofiles');
  const Appointment = mongoose.model('Appointment', new mongoose.Schema({}, { strict: false }), 'appointments');

  const kiran = await Patient.findOne({ mobile: '9019999999' }) as any;
  console.log('Kiran User:', kiran ? { id: kiran._id, name: kiran.name } : 'Not Found');

  if (kiran) {
    const profiles = await PatientProfile.find({ user: kiran._id }) as any[];
    console.log('Kiran Profiles:', profiles.map(p => ({ id: p._id, mrn: p.mrn, hospital: p.hospital })));

    const appointments = await Appointment.find({ patient: kiran._id }).limit(5) as any[];
    console.log('Kiran Appointments:', appointments.map(a => ({ id: a._id, mrn: a.mrn, date: a.date, hospital: a.hospital })));
  }

  await mongoose.disconnect();
}

check().catch(console.error);
