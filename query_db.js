import mongoose from 'mongoose';

const uri = "mongodb://localhost:27017/Curechain";

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  
  const patientIdStr = "6a7ebdaf72104c8b5e2f3212";
  const patientId = new mongoose.Types.ObjectId(patientIdStr);
  
  const labOrders = await db.collection("laborders").find({ 
    $or: [{ patient: patientId }, { globalPatientId: patientId }] 
  }).toArray();
  
  const pharmOrders = await db.collection("pharmacyorders").find({ 
    $or: [{ patient: patientId }, { globalPatientId: patientId }] 
  }).toArray();

  const transactions = await db.collection("transactions").find({
    $or: [{ user: patientId }]
  }).toArray();
  
  console.log("Lab Orders:");
  console.log(JSON.stringify(labOrders, null, 2));
  
  console.log("Pharmacy Orders:");
  console.log(JSON.stringify(pharmOrders, null, 2));

  console.log("Transactions:");
  console.log(JSON.stringify(transactions, null, 2));
  
  process.exit(0);
}

run();
