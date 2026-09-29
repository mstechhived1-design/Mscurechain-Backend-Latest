const { MongoClient } = require('mongodb');

const uri = "mongodb://mstechhive2_db_user:3ynXXiwJQeoIaqZP@ac-db7xfbd-shard-00-00.uimxxl9.mongodb.net:27017,ac-db7xfbd-shard-00-01.uimxxl9.mongodb.net:27017,ac-db7xfbd-shard-00-02.uimxxl9.mongodb.net:27017/curechain?ssl=true&authSource=admin&retryWrites=true&w=majority";

async function run() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('curechain');
    
    const hospitalsCollection = db.collection('hospitals');
    const hospitals = await hospitalsCollection.find({}, { projection: { name: 1, hospitalName: 1 } }).toArray();
    
    const hospitalSizes = {};
    for (const h of hospitals) {
      hospitalSizes[h._id.toString()] = {
        name: h.name || h.hospitalName,
        sizeBytes: 0
      };
    }

    const collections = await db.listCollections().toArray();
    
    for (const collInfo of collections) {
      const collName = collInfo.name;
      if (collName.startsWith('system.')) continue;
      
      const coll = db.collection(collName);
      
      try {
        const pipeline = [
          {
            $project: {
              hid: { $ifNull: ["$hospitalId", { $ifNull: ["$hospital", null] }] },
              size: { $bsonSize: "$$ROOT" }
            }
          },
          {
            $match: { hid: { $ne: null } }
          },
          {
            $group: {
              _id: "$hid",
              totalSize: { $sum: "$size" }
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
        // ignore
      }
    }
    
    console.log("Data size per hospital (Approximated based on 'hospitalId' and 'hospital' fields):");
    let totalAccountedBytes = 0;
    for (const hid in hospitalSizes) {
      const bytes = hospitalSizes[hid].sizeBytes;
      totalAccountedBytes += bytes;
      const sizeMB = (bytes / 1024 / 1024).toFixed(4);
      console.log(`- ${hospitalSizes[hid].name}: ${sizeMB} MB`);
    }
    console.log(`Total accounted for hospitals: ${(totalAccountedBytes / 1024 / 1024).toFixed(4)} MB`);
    
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
