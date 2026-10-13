import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  
  for (const name of ['sumitra', 'Samual Raj', 'Ramana']) {
    const p = await db.collection('patients').findOne({ name: new RegExp(name, 'i') });
    const pf = await db.collection('patientprofiles').findOne({ $or: [{ contactNumber: p?.mobile }, { mrn: p?.mrn }] });
    const appt = await db.collection('appointments').findOne({ $or: [{ patientName: new RegExp(name, 'i') }, { 'patientDetails.name': new RegExp(name, 'i') }] });
    console.log(name, {
      patient: p ? { name: p.name, honorific: p.honorific, mobile: p.mobile, mrn: p.mrn } : null,
      profile: pf ? { mrn: pf.mrn, honorific: pf.honorific } : null,
      appt: appt ? { name: appt.patientDetails?.name || appt.patientName, honorific: appt.appointmentHonorific || appt.honorific || appt.patientDetails?.honorific } : null
    });
  }
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
