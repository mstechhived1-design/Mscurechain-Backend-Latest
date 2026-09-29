import mongoose from 'mongoose';

const uri = "mongodb://localhost:27017/Curechain";

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
    console.log("Tests in first LabOrder:");
    console.log(JSON.stringify(labOrders[0].tests, null, 2));
    console.log("Total Amount:", labOrders[0].totalAmount);
  }
  
  console.log("Pharmacy Orders Count:", pharmOrders.length);
  if (pharmOrders.length > 0) {
    console.log("Medicines in first PharmOrder:");
    console.log(JSON.stringify(pharmOrders[0].medicines, null, 2));
    console.log("Total Amount:", pharmOrders[0].totalAmount);
  }

  process.exit(0);
}

run();
