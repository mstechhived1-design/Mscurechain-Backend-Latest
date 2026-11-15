const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const IPDBillingController = await import('../IPD/Controllers/IPDBillingController.js');
  const breakdown = await IPDBillingController.calculateBillBreakdown('IPD-HHO6590105');
  console.log('--- calculateBillBreakdown for IPD-HHO6590105 ---');
  console.log('Bed Total:', breakdown.bedCharges?.total);
  console.log('Category breakdown:', breakdown.extraCharges?.categoryBreakdown);
  console.log('Total Advances in breakdown:', breakdown.financials?.totalAdvance);
  console.log('Advances array in breakdown:', breakdown.advances?.map(a => ({
    receiptNumber: a.receiptNumber || a.reference,
    amount: a.amount,
    description: a.description,
    isExternal: a.isExternal
  })));

  await mongoose.disconnect();
}
check();
