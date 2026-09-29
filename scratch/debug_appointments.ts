import mongoose from 'mongoose';

const mongoUri = 'mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain'; 

async function run() {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error("Database connection not ready");
    return;
  }
  const Appointment = db.collection('appointments');

  const appointments = await Appointment.find({ mrn: 'HHO388000102' }).sort({ date: 1 }).toArray();
  console.log('Appointments found:');
  appointments.forEach(apt => {
    console.log(`ID: ${apt._id}, Date: ${apt.date}, Status: ${apt.status}, Type: ${apt.type}, PaymentStatus: ${apt.payment?.paymentStatus || apt.paymentStatus}, Amount: ${apt.payment?.amount || apt.amount}`);
  });

  process.exit(0);
}

run().catch(console.error);
