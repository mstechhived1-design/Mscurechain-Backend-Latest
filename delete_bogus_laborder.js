import mongoose from 'mongoose';

const uri = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function run() {
  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    
    // Explicitly targeting the exact hospital and patient
    const hospitalId = new mongoose.Types.ObjectId("69a7b003c84f8f6e66180872");
    const patientId = new mongoose.Types.ObjectId("6a7ebdaf72104c8b5e2f3212");
    
    const labOrders = await db.collection("laborders").find({ 
      hospital: hospitalId,
      $or: [{ patient: patientId }, { globalPatientId: patientId }] 
    }).toArray();
    
    let deletedCount = 0;
    
    for (const order of labOrders) {
      // If the order has an abnormally large number of tests (like the 135 bugged tests)
      // and is not the CBC order (which has 1 test and 500 rupees)
      if (order.tests && order.tests.length > 50) {
        console.log(`Deleting bugged LabOrder ${order._id} with ${order.tests.length} tests and amount ${order.totalAmount}`);
        await db.collection("laborders").deleteOne({ _id: order._id });
        deletedCount++;
      }
    }
    
    console.log(`Successfully deleted ${deletedCount} corrupted lab order(s) for hospital 69a7b003c84f8f6e66180872.`);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

run();
