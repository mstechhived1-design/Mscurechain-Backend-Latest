import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    
    // Extract db name from URI or use default
    const dbName = uri.split('/').pop().split('?')[0] || "curechain";
    const db = client.db(dbName);
    
    const hospitalId = new ObjectId("69a7b003c84f8f6e66180872");
    
    const laborders = db.collection("laborders");
    const transactions = db.collection("transactions");
    
    const orders = await laborders.find({ hospital: hospitalId, sampleId: { $in: ["SMP-0186", "SMP-0187"] } }).toArray();
    
    console.log(`Found ${orders.length} orders.`);
    
    for (const order of orders) {
      if (order.invoiceId) {
        console.log(`Deleting transaction: ${order.invoiceId}`);
        await transactions.deleteOne({ _id: order.invoiceId });
      }
      console.log(`Deleting lab order: ${order._id}`);
      await laborders.deleteOne({ _id: order._id });
    }
    
    console.log("Deleted successfully.");
  } finally {
    await client.close();
  }
}

run().catch(console.dir);
