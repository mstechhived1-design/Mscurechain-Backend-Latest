const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function checkData() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('curechain');
        
        const occupancies = await db.collection('bedoccupancies').find({ 
            // the _id of the admission we found earlier:
            // "69a921cf995735d89bd60e66"
        }).toArray();
        
        console.log("Found ALL bedoccupancies to see what fields they have:");
        const allOccs = await db.collection('bedoccupancies').find().toArray();
        const relevantOcc = allOccs.filter(o => String(o.admission) === "69a921cf995735d89bd60e66");
        
        console.log(JSON.stringify(relevantOcc, null, 2));
        
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

checkData();
