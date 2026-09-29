const { MongoClient } = require('mongodb');

const uri = "mongodb://mstechhive2_db_user:3ynXXiwJQeoIaqZP@ac-db7xfbd-shard-00-00.uimxxl9.mongodb.net:27017,ac-db7xfbd-shard-00-01.uimxxl9.mongodb.net:27017,ac-db7xfbd-shard-00-02.uimxxl9.mongodb.net:27017/curechain?ssl=true&authSource=admin&retryWrites=true&w=majority";

async function run() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("Connected correctly to server");
    
    const db = client.db('curechain');
    
    // Get DB Stats
    const stats = await db.command({ dbStats: 1 });
    console.log("Database Stats:");
    console.log(`- Data Size: ${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`- Storage Size (Occupied): ${(stats.storageSize / 1024 / 1024).toFixed(2)} MB`);

    // Get number of hospitals
    const hospitalsCollection = db.collection('hospitals');
    const hospitalCount = await hospitalsCollection.countDocuments();
    console.log(`\nNumber of Hospitals: ${hospitalCount}`);
    
    const hospitals = await hospitalsCollection.find({}, { projection: { name: 1, hospitalName: 1 } }).toArray();
    console.log("\nHospital List:");
    
    // Calculate approximate size per hospital
    // To do this properly, we need to iterate over major collections and group by hospitalId.
    // For simplicity, we just list them.
    for (const hospital of hospitals) {
      console.log(`- ${hospital.name || hospital.hospitalName} (ID: ${hospital._id})`);
    }
    
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
