const mongoose = require('mongoose');

const mongoUri = 'mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain'; 

async function run() {
  await mongoose.connect(mongoUri);
  
  const db = mongoose.connection.db;
  const Appointment = db.collection('appointments');

  const patientIds = [ '6a425768e3accfd2c7b43e32', '6a425768e3accfd2c7b43e2d' ];

  const patientMatchCondition = {
    $or: patientIds.flatMap(pid => {
      const conds = [{ patient: pid }, { globalPatientId: pid }];
      if (mongoose.Types.ObjectId.isValid(pid)) {
        conds.push({ patient: new mongoose.Types.ObjectId(pid) });
        conds.push({ globalPatientId: new mongoose.Types.ObjectId(pid) });
      }
      return conds;
    }),
  };

  const apt = await Appointment.findOne({
    _id: new mongoose.Types.ObjectId("6a44b57ccafb86a38f76413f")
  });

  console.log("Appointment detail keys:");
  console.log("patient:", apt.patient, typeof apt.patient);
  console.log("globalPatientId:", apt.globalPatientId, typeof apt.globalPatientId);

  // Test match
  const count = await Appointment.countDocuments({
    _id: new mongoose.Types.ObjectId("6a44b57ccafb86a38f76413f"),
    ...patientMatchCondition
  });
  console.log("Match count:", count);

  mongoose.connection.close();
}

run().catch(console.error);
