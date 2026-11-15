const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const match = {
    $or: [
      { isWalkIn: true },
      { patientType: { $in: ["WALKIN", "Walk-in", "walkin", "Walk-In", "WALK_IN"] } }
    ]
  };

  const results = await db.collection('pharmainvoices').find(match).toArray();
  console.log(`Found ${results.length} walk-in records in pharmainvoices:`);
  results.forEach(r => {
    console.log({
      invoiceNo: r.invoiceNo,
      patientName: r.patientName,
      patientType: r.patientType,
      isWalkIn: r.isWalkIn,
      isIPD: r.isIPD,
      total: r.total,
      paid: r.paid,
      status: r.status,
      mode: r.mode
    });
  });

  await mongoose.disconnect();
}
check();
