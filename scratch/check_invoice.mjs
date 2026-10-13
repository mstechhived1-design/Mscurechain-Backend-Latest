import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const inv = await db.collection('pharmainvoices').findOne({ invoiceNo: 'RAM-381-0100' });
  console.log('FULL INVOICE RAM-381-0100:', JSON.stringify(inv, null, 2));
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
