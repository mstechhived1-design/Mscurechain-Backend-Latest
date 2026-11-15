const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const inv = await db.collection('pharmainvoices').findOne({ invoiceNo: 'RAM-727-0039' });
  console.log('Found RAM-727-0039 in pharmainvoices:', JSON.stringify(inv, null, 2));

  // Also find all invoices in pharmainvoices where invoiceNo is one of those shown under WALK-IN
  const list = ['RAM-727-0039', 'RAM-228-0038', 'RAM-253-0037', 'RAM-745-0036', 'RAM-971-0035', 'RAM-266-0034'];
  const found = await db.collection('pharmainvoices').find({ invoiceNo: { $in: list } }).toArray();
  console.log('Found in pharmainvoices:');
  found.forEach(f => {
    console.log({
      invoiceNo: f.invoiceNo,
      patientName: f.patientName,
      patientType: f.patientType,
      isWalkIn: f.isWalkIn,
      isIPD: f.isIPD,
      patient: f.patient,
      mode: f.mode,
      status: f.status,
      total: f.total,
      paid: f.paid,
      balance: f.balance,
      createdAt: f.createdAt
    });
  });

  await mongoose.disconnect();
}
check();
