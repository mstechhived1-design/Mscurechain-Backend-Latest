const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const inv = await db.collection('pharmainvoices').findOne({
    invoiceNo: 'RAM-263-0040'
  });

  if (inv) {
    console.log('Invoice found in pharmainvoices!');
    console.log('items:', JSON.stringify(inv.items, null, 2));
  } else {
    console.log('Not in pharmainvoices with invoiceNo RAM-263-0040. Searching collections...');
    const collections = await db.listCollections().toArray();
    for (const c of collections) {
      const doc = await db.collection(c.name).findOne({
        invoiceNo: 'RAM-263-0040'
      });
      if (doc) {
        console.log('Found in collection:', c.name);
        console.log('items:', JSON.stringify(doc.items || doc.medicines, null, 2));
      }
    }
  }

  await mongoose.disconnect();
}
check();
