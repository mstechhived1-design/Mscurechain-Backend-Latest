require('dotenv').config();
const { MongoClient } = require('mongodb');

async function main() {
  const uri = process.env.MONGO_URI;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('curechain');
    
    console.log("Connected. Deleting records for PHARMA-761239-163-109");
    const tokenStr = "PHARMA-761239-163-109";
    
    // Find the token
    const token = await db.collection('pharmacytokens').findOne({ tokenNumber: tokenStr });
    
    if (token) {
        console.log("Found token with ID:", token._id);
        
        // Delete token
        const tDel = await db.collection('pharmacytokens').deleteOne({ _id: token._id });
        console.log("Deleted token:", tDel.deletedCount);
        
        // Delete related orders
        const oDel = await db.collection('pharmacyorders').deleteMany({ tokenNumber: tokenStr });
        console.log("Deleted pharmacy orders by tokenNumber:", oDel.deletedCount);
        
        const oDel2 = await db.collection('pharmacyorders').deleteMany({ pharmacyTokenId: token._id });
        console.log("Deleted pharmacy orders by pharmacyTokenId:", oDel2.deletedCount);
        
        // Let's also check if there are any invoices
        const cols = await db.listCollections().toArray();
        for (let c of cols) {
            if (c.name === 'pharmacytokens' || c.name === 'pharmacyorders') continue;
            try {
               const regexDocs = await db.collection(c.name).find({
                   $or: [
                       { tokenNumber: tokenStr },
                       { token: tokenStr },
                       { "orderItems.tokenNumber": tokenStr }
                   ]
               }).toArray();
               
               if (regexDocs && regexDocs.length > 0) {
                   const delRes = await db.collection(c.name).deleteMany({
                       $or: [
                           { tokenNumber: tokenStr },
                           { token: tokenStr },
                           { "orderItems.tokenNumber": tokenStr }
                       ]
                   });
                   console.log(`Deleted ${delRes.deletedCount} from ${c.name}`);
               }
            } catch(e) {
                // ignore
            }
        }
    } else {
        console.log("Token not found.");
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.close();
  }
}

main();
