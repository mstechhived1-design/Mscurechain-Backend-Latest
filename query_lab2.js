import mongoose from 'mongoose';

const uri = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  
  const patientId = new mongoose.Types.ObjectId("6a7ebdaf72104c8b5e2f3212");
  
  const labOrders = await db.collection("laborders").find({ 
    $or: [{ patient: patientId }, { globalPatientId: patientId }] 
  }).toArray();
  
  const order = labOrders[1]; // the one with 135 tests
  
  let validCount = 0;
  let invalidCount = 0;
  for (const t of order.tests) {
    const testDoc = await db.collection("labtests").findOne({ _id: t.test });
    if (testDoc) {
      validCount++;
    } else {
      invalidCount++;
    }
  }
  
  console.log(`Order has ${order.tests.length} tests.`);
  console.log(`Found in LabTest DB: ${validCount}`);
  console.log(`NOT found in LabTest DB (null): ${invalidCount}`);

  process.exit(0);
}

run();
