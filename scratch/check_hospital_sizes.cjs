const { MongoClient } = require('mongodb');

const uri = "mongodb://mstechhive2_db_user:3ynXXiwJQeoIaqZP@ac-db7xfbd-shard-00-00.uimxxl9.mongodb.net:27017,ac-db7xfbd-shard-00-01.uimxxl9.mongodb.net:27017,ac-db7xfbd-shard-00-02.uimxxl9.mongodb.net:27017/curechain?ssl=true&authSource=admin&retryWrites=true&w=majority";

async function run() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('curechain');
    
    const hospitalsCollection = db.collection('hospitals');
    const hospitals = await hospitalsCollection.find({}, { projection: { name: 1, hospitalName: 1 } }).toArray();
    
    // Map to hold sizes
    const hospitalSizes = {};
    for (const h of hospitals) {
      hospitalSizes[h._id.toString()] = {
        name: h.name || h.hospitalName,
        sizeBytes: 0
      };
    }

    // Get all collections
    const collections = await db.listCollections().toArray();
    
    for (const collInfo of collections) {
      const collName = collInfo.name;
      // Skip system collections
      if (collName.startsWith('system.')) continue;
      
      const coll = db.collection(collName);
      
      // Try to aggregate size by hospitalId
      try {
        const pipeline = [
          {
            $match: { hospitalId: { $exists: true } }
          },
          {
            $group: {
              _id: "$hospitalId",
              totalSize: { $sum: { $bsonSize: "$$ROOT" } }
            }
          }
        ];
        
        const results = await coll.aggregate(pipeline).toArray();
        for (const res of results) {
          const hid = res._id ? res._id.toString() : null;
          if (hid && hospitalSizes[hid]) {
            hospitalSizes[hid].sizeBytes += res.totalSize;
          }
        }
      } catch (err) {
        // If $bsonSize is not supported or collection is a view, ignore
      }
    }
    
    console.log("Data size per hospital (Approximated based on documents with hospitalId):");
    for (const hid in hospitalSizes) {
      const sizeMB = (hospitalSizes[hid].sizeBytes / 1024 / 1024).toFixed(4);
      console.log(`- ${hospitalSizes[hid].name}: ${sizeMB} MB`);
    }
    
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
