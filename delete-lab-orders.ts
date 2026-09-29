import mongoose from 'mongoose';
import dotenv from 'dotenv';
import LabOrder from './Lab/Models/LabOrder.js';
import Transaction from './Admin/Models/Transaction.js';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/curechain');
  const hospitalId = '69a7b003c84f8f6e66180872';
  const orders = await LabOrder.find({ hospital: hospitalId, sampleId: { $in: ['SMP-0186', 'SMP-0187'] } });
  
  console.log('Found orders:', orders.map(o => ({ id: o._id, sampleId: o.sampleId, invoiceId: o.invoiceId })));
  
  for (const order of orders) {
    if (order.invoiceId) {
      const tx = await Transaction.findById(order.invoiceId);
      if (tx) {
        console.log(`Deleting transaction ${tx._id} for sample ${order.sampleId}`);
        await Transaction.findByIdAndDelete(tx._id);
      }
    }
    console.log(`Deleting lab order ${order._id} for sample ${order.sampleId}`);
    await LabOrder.findByIdAndDelete(order._id);
  }
  
  console.log('Done deleting.');
  process.exit(0);
}

run().catch(console.error);
