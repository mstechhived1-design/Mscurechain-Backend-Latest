const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const anyInv = await db.collection('pharmainvoices').find().sort({ _id: -1 }).limit(10).toArray();
  console.log('Recent 10 pharmainvoices:', anyInv.map(i => ({
    _id: i._id,
    invoiceNumber: i.invoiceNumber,
    billNumber: i.billNumber,
    invoiceNo: i.invoiceNo,
    patientName: i.patientName,
    patientType: i.patientType,
    isWalkIn: i.isWalkIn,
    total: i.total,
    paid: i.paid,
    status: i.status
  })));

  const anyIss = await db.collection('ipdmedicineissuances').find().sort({ _id: -1 }).limit(10).toArray();
  console.log('Recent 10 ipdmedicineissuances:', anyIss.map(i => ({
    _id: i._id,
    issueNumber: i.issueNumber,
    invoiceNumber: i.invoiceNumber,
    admissionId: i.admissionId,
    totalAmount: i.totalAmount,
    status: i.status
  })));

  // Let's find admission IPD-HHO6590105
  const adm = await db.collection('ipdadmissions').findOne({ admissionId: 'IPD-HHO6590105' });
  console.log('Admission IPD-HHO6590105:', adm ? {
    _id: adm._id,
    admissionId: adm.admissionId,
    status: adm.status,
    patientDetails: adm.patientDetails,
    patientId: adm.patientId
  } : 'NOT FOUND');

  if (adm) {
    const issForAdm = await db.collection('ipdmedicineissuances').find({
      $or: [
        { admission: adm._id },
        { admissionId: adm.admissionId }
      ]
    }).toArray();
    console.log('Issuances for Alibaba admission:', issForAdm.map(x => ({
      _id: x._id,
      invoiceNumber: x.invoiceNumber,
      issueNumber: x.issueNumber,
      totalAmount: x.totalAmount,
      status: x.status,
      itemsCount: x.medicines ? x.medicines.length : (x.items ? x.items.length : 0)
    })));
  }

  await mongoose.disconnect();
}
check();
