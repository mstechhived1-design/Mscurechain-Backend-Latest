import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGO_URI || "mongodb+srv://curechain1:curechain1@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function main() {
  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  const collections = ['users', 'doctorprofiles', 'staffprofiles', 'patients', 'hospitals', 'ipdadmissions', 'pharmainvoices', 'laborders', 'attendances', 'appointments'];
  
  for (const collName of collections) {
    try {
      const coll = mongoose.connection.collection(collName);
      const indexes = await coll.indexes();
      console.log(`\nIndexes for ${collName}:`);
      indexes.forEach(idx => {
        console.log(` - ${idx.name} : ${JSON.stringify(idx.key)}`);
      });
    } catch (err) {
      console.log(`Error reading ${collName}`);
    }
  }

  // Find slow queries from profiler if possible
  try {
     const db = mongoose.connection.db;
     // Requires high privileges, might fail on Atlas
     // const profile = await db.collection('system.profile').find({ millis: { $gt: 100 } }).sort({ ts: -1 }).limit(10).toArray();
     // console.log("Slow queries:", profile);
  } catch (err) {
  }

  await mongoose.disconnect();
}
main().catch(console.error);
