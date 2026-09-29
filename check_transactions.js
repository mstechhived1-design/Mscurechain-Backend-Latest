import mongoose from 'mongoose';

const uri = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  
  const hospitalId = new mongoose.Types.ObjectId("69a7b003c84f8f6e66180872");
  
  const transactions = await db.collection("transactions").find({ 
    hospital: hospitalId
  }).sort({ createdAt: -1 }).limit(10).toArray();
  
  console.log("Recent Transactions:");
  transactions.forEach(t => {
    console.log(`- ID: ${t._id}, Type: ${t.type}, Amount: ${t.amount}, Status: ${t.status}, Mode: ${t.paymentMode}, User: ${t.user}`);
  });
  
  process.exit(0);
}

run();
