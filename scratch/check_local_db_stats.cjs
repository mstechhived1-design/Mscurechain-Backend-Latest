const { MongoClient } = require('mongodb');

const uri = "mongodb://localhost:27017/Curechain";

async function run() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("Connected correctly to local server");
    
    const db = client.db('Curechain');
    
    // Get DB Stats
    const stats = await db.command({ dbStats: 1 });
    console.log("Database Stats:");
    console.log(`- Data Size: ${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`- Storage Size (Occupied): ${(stats.storageSize / 1024 / 1024).toFixed(2)} MB`);
    // Note: MongoDB free tier locally is just limited by disk space.

    // Get number of hospitals
    const hospitalsCollection = db.collection('hospitals');
    const hospitalCount = await hospitalsCollection.countDocuments();
    console.log(`\nNumber of Hospitals: ${hospitalCount}`);
    
    // List hospitals and try to approximate data size.
    // For exact size per hospital, one needs to measure BSON size of documents containing the hospitalId.
    // That's complex. We will just list the hospitals for now.
    const hospitals = await hospitalsCollection.find({}).toArray();
    console.log("\nHospital List:");
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
