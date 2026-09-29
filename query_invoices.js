import mongoose from 'mongoose';

const uri = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  
  const invoices = await db.collection("pharmainvoices").find({ 
    patientName: { $regex: /Ramana/i }
  }).toArray();
  
  console.log("Invoices Count:", invoices.length);
  if (invoices.length > 0) {
    console.log("First Invoice:", JSON.stringify(invoices[0], null, 2));
  }
  
  process.exit(0);
}

run();
