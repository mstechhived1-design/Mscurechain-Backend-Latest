import mongoose from 'mongoose';

const uri = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  
  const patientId = new mongoose.Types.ObjectId("6a7ebdaf72104c8b5e2f3212");
  
  const labOrders = await db.collection("laborders").find({ 
    $or: [{ patient: patientId }, { globalPatientId: patientId }] 
  }).toArray();
  
  console.log("Lab Orders Count:", labOrders.length);
  for (let i = 0; i < labOrders.length; i++) {
    const o = labOrders[i];
    console.log(`Order ${i} tests length:`, o.tests ? o.tests.length : 0, `Total Amount:`, o.totalAmount);
    if (o.tests && o.tests.length > 10) {
      console.log("First 3 tests of this large order:", JSON.stringify(o.tests.slice(0, 3), null, 2));
    }
  }

  process.exit(0);
}

run();
