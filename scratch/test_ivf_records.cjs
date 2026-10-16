const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');

const uri = 'mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';
const hospitalId = new mongoose.Types.ObjectId('6a0850656ecbe4898e5d0dfe');

async function inspectIvf() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const ivfSymptomRegex = /ivf|infertility|fertility|icsi|iui|follicular|ovulation|pcos|pcod|maternity|antenatal|delivery|c-section|cesarean|caesarean|labour|labor|conception|embryo|blastocyst|amennorhea|azoospermia|oligospermia/i;

  // 1. Appointments matching regex
  const matchedAppts = await db.collection('appointments').find({
    hospital: hospitalId,
    $or: [
      { symptoms: { $regex: ivfSymptomRegex } },
      { reason: { $regex: ivfSymptomRegex } },
      { department: { $regex: /fertility|ivf|maternity|obs|gyn/i } },
    ]
  }).toArray();
  console.log('--- MATCHED APPOINTMENTS (' + matchedAppts.length + ') ---');
  matchedAppts.forEach(a => {
    console.log(JSON.stringify({
      id: a._id,
      patient: a.patient,
      reason: a.reason,
      symptoms: a.symptoms,
      department: a.department,
      status: a.status
    }));
  });

  // 2. PatientProfiles matching regex
  const matchedProfiles = await db.collection('patientprofiles').find({
    hospital: hospitalId,
    $or: [
      { conditions: { $regex: ivfSymptomRegex } },
      { condition: { $regex: ivfSymptomRegex } },
      { medicalHistory: { $regex: ivfSymptomRegex } },
      { notes: { $regex: ivfSymptomRegex } },
    ]
  }).toArray();
  console.log('--- MATCHED PATIENT PROFILES (' + matchedProfiles.length + ') ---');
  matchedProfiles.forEach(p => {
    console.log(JSON.stringify({
      id: p._id,
      user: p.user,
      conditions: p.conditions,
      condition: p.condition,
      medicalHistory: p.medicalHistory,
      notes: p.notes
    }));
  });

  // 3. Let's inspect IPD admissions diagnosis or department
  const ipdWithDiagnosis = await db.collection('ipdadmissions').find({
    hospital: hospitalId,
    $or: [
      { diagnosis: { $exists: true, $ne: "" } },
      { reasonForAdmission: { $exists: true, $ne: "" } },
      { department: { $exists: true, $ne: "" } },
    ]
  }).toArray();
  console.log('--- IPD WITH DIAGNOSIS/REASON/DEPT (' + ipdWithDiagnosis.length + ') ---');

  // 4. Check gynecology/obstetric examinations or prescriptions
  const gynPrescriptions = await db.collection('prescriptions').find({
    hospital: hospitalId,
    $or: [
      { diagnosis: { $regex: ivfSymptomRegex } },
      { chiefComplaints: { $regex: ivfSymptomRegex } }
    ]
  }).toArray();
  console.log('--- PRESCRIPTIONS MATCHING IVF/DELIVERY (' + gynPrescriptions.length + ') ---');
  gynPrescriptions.forEach(p => {
    console.log(JSON.stringify({
      id: p._id,
      patient: p.patient,
      diagnosis: p.diagnosis,
      chiefComplaints: p.chiefComplaints
    }));
  });

  // 5. Check clinical notes matching ivf
  const matchedNotes = await db.collection('clinicalnotes').find({
    hospital: hospitalId,
    note: { $regex: ivfSymptomRegex }
  }).toArray();
  console.log('--- CLINICAL NOTES MATCHING IVF/DELIVERY (' + matchedNotes.length + ') ---');
  matchedNotes.forEach(n => {
    console.log(JSON.stringify({
      id: n._id,
      patient: n.patient,
      note: n.note
    }));
  });

  await mongoose.disconnect();
}

inspectIvf().catch(console.error);
