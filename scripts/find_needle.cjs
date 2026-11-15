const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const collections = await db.listCollections().toArray();
  console.log(`Checking ${collections.length} collections for RAM-727-0039...`);

  for (const colInfo of collections) {
    const colName = colInfo.name;
    try {
      const doc = await db.collection(colName).findOne({
        $or: [
          { invoiceNo: 'RAM-727-0039' },
          { invoiceNumber: 'RAM-727-0039' },
          { billNumber: 'RAM-727-0039' },
          { receiptNo: 'RAM-727-0039' },
          { transactionId: 'RAM-727-0039' },
          { reference: 'RAM-727-0039' }
        ]
      });
      if (doc) {
        console.log(`>>> MATCH FOUND IN COLLECTION: ${colName}!`);
        console.log(JSON.stringify(doc, null, 2));
      }
    } catch (e) {
      // ignore
    }
  }

  await mongoose.disconnect();
}
check();
