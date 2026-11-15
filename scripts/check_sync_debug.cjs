const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const patientId = new mongoose.Types.ObjectId('6a06f3c212ee21a2a85902ef');

  console.log('=== Checking IPDAdmission for Patient ===');
  const adm = await db.collection('ipdadmissions').findOne({ patient: patientId });
  console.log('Admission:', adm ? {
    _id: adm._id,
    admissionId: adm.admissionId,
    status: adm.status,
    totalBilledAmount: adm.totalBilledAmount
  } : 'NOT FOUND');

  console.log('=== Checking RAM-727-0039 in ipdmedicineissuances ===');
  const iss = await db.collection('ipdmedicineissuances').findOne({ invoiceNo: 'RAM-727-0039' });
  console.log('Issuance:', iss ? {
    _id: iss._id,
    invoiceNo: iss.invoiceNo,
    status: iss.status,
    totalAmount: iss.totalAmount,
    paid: iss.paid,
    mode: iss.mode
  } : 'NOT FOUND');

  console.log('=== Checking RAM-727-0039 in pharmainvoices ===');
  const inv = await db.collection('pharmainvoices').findOne({ invoiceNo: 'RAM-727-0039' });
  console.log('Invoice:', inv ? {
    _id: inv._id,
    invoiceNo: inv.invoiceNo,
    status: inv.status,
    total: inv.total,
    paid: inv.paid,
    mode: inv.mode
  } : 'NOT FOUND');

  console.log('=== Checking IPDAdvancePayment for admission ===');
  if (adm) {
    const advs = await db.collection('ipdadvancepayments').find({ admission: adm._id }).toArray();
    console.log('Advances count:', advs.length);
    advs.forEach(a => {
      console.log({
        _id: a._id,
        receiptNumber: a.receiptNumber,
        reference: a.reference,
        amount: a.amount,
        mode: a.mode,
        notes: a.notes,
        date: a.date
      });
    });
  }

  console.log('=== Checking Transaction for patient / RAM-727-0039 ===');
  const txns = await db.collection('transactions').find({
    $or: [
      { invoiceNumber: 'RAM-727-0039' },
      { referenceId: iss?._id },
      { receiptNumber: 'RAM-727-0039' }
    ]
  }).toArray();
  console.log('Transactions matching RAM-727-0039:', txns.length);
  txns.forEach(t => {
    console.log({
      _id: t._id,
      invoiceNumber: t.invoiceNumber,
      amount: t.amount,
      paymentMode: t.paymentMode,
      status: t.status,
      type: t.type
    });
  });

  console.log('=== Checking TransactionReport for patient ===');
  const savedReports = await db.collection('transactionreports').find({ patient: patientId }).sort({ createdAt: -1 }).toArray();
  console.log('Saved TransactionReports count:', savedReports.length);
  savedReports.forEach(r => {
    console.log({
      _id: r._id,
      patientType: r.patientType,
      admission: r.admission,
      paymentsCount: r.reportData?.payments?.length || 0,
      payments: r.reportData?.payments,
      totals: r.totals
    });
  });

  await mongoose.disconnect();
}
check();
