const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function checkData() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('curechain');
        
        const beds = await db.collection('ipdbeds').find({
            _id: { $in: [
                new (require('mongodb').ObjectId)("69a8fd211629c151458c3601"),
                new (require('mongodb').ObjectId)("69a8fd211629c151458c3608")
            ]}
        }).toArray();
        
        console.log(JSON.stringify(beds.map(b => ({ bedId: b.bedId, _id: b._id })), null, 2));
        
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

checkData();
