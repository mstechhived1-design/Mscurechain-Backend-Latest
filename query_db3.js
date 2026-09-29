import mongoose from 'mongoose';

const uri = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  
  const patientIdStr = "69a7b003c84f8f6e66180872";
  const patientId = new mongoose.Types.ObjectId(patientIdStr);
  
  const labOrders = await db.collection("laborders").find({ 
    $or: [{ patient: patientId }, { globalPatientId: patientId }] 
  }).toArray();
  
  const pharmOrders = await db.collection("pharmacyorders").find({ 
    $or: [{ patient: patientId }, { globalPatientId: patientId }] 
  }).toArray();
  
  console.log("Lab Orders Count:", labOrders.length);
  if (labOrders.length > 0) {
    console.log("Tests in first LabOrder:", labOrders[0].tests.length);
    console.log("Tests in second LabOrder:", labOrders[1]?.tests.length);
  }
  
  console.log("Pharmacy Orders Count:", pharmOrders.length);
  if (pharmOrders.length > 0) {
    console.log("Medicines in first PharmOrder:", pharmOrders[0].medicines.length);
  }

  process.exit(0);
}

run();
