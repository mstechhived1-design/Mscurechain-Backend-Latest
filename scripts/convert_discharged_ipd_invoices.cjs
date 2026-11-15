const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB successfully!');

    const IPDAdmission = mongoose.model('IPDAdmission', new mongoose.Schema({}, { strict: false }));
    const IPDMedicineIssuance = mongoose.model('IPDMedicineIssuance', new mongoose.Schema({}, { strict: false }));
    const PharmaInvoice = mongoose.model('PharmaInvoice', new mongoose.Schema({}, { strict: false }));

    // 1. Find all discharged admissions
    const dischargedAdmissions = await IPDAdmission.find({ status: 'Discharged' }).select('_id admissionId patientDetails.name dischargeDate').lean();
    console.log(`Found ${dischargedAdmissions.length} Discharged admissions.`);

    const dischargedIds = dischargedAdmissions.map(a => a._id);
    const dischargedAdmIds = dischargedAdmissions.map(a => a.admissionId);

    // 2. Update IPDMedicineIssuance for discharged admissions
    const issuancesToUpdate = await IPDMedicineIssuance.find({
      $or: [
        { admission: { $in: dischargedIds } },
        { admissionId: { $in: dischargedAdmIds } }
      ],
      status: { $ne: 'CLOSED' }
    });

    console.log(`Found ${issuancesToUpdate.length} IPD medicine issuances for discharged admissions to mark CLOSED/PAID.`);

    let updatedIssuancesCount = 0;
    for (const iss of issuancesToUpdate) {
      iss.status = 'CLOSED';
      await iss.save();
      updatedIssuancesCount++;
    }
    console.log(`Successfully updated ${updatedIssuancesCount} IPD medicine issuances to CLOSED (Discharged).`);

    // 3. Update PharmaInvoice for discharged admissions
    const invoicesToUpdate = await PharmaInvoice.find({
      $or: [
        { admission: { $in: dischargedIds } },
        { admissionId: { $in: dischargedAdmIds } },
        { isIPD: true, patientType: 'IPD' }
      ],
      $or: [
        { status: { $ne: 'PAID' } },
        { balance: { $gt: 0 } }
      ]
    });

    // Also specifically match those whose admission is discharged
    const matchedDischargedInvoices = await PharmaInvoice.find({
      $or: [
        { admission: { $in: dischargedIds } },
        { admissionId: { $in: dischargedAdmIds } }
      ]
    });

    console.log(`Found ${matchedDischargedInvoices.length} Pharma Invoices associated with discharged admissions.`);
    let updatedInvoicesCount = 0;
    for (const inv of matchedDischargedInvoices) {
      if (inv.status !== 'PAID' || inv.balance > 0 || !inv.paid || inv.paid < inv.netPayable) {
        inv.status = 'PAID';
        inv.paid = inv.netPayable || inv.subTotal || 0;
        inv.balance = 0;
        await inv.save();
        updatedInvoicesCount++;
      }
    }
    console.log(`Successfully updated ${updatedInvoicesCount} Pharma Invoices to PAID (Settled via Discharge).`);

    // 4. Check active admissions status (e.g., Mr. Alibaba)
    const activeAdmissions = await IPDAdmission.find({ status: 'Active' }).select('_id admissionId').lean();
    const activeIds = activeAdmissions.map(a => a._id);
    const activeAdmIds = activeAdmissions.map(a => a.admissionId);

    const activeIssuances = await IPDMedicineIssuance.find({
      $or: [
        { admission: { $in: activeIds } },
        { admissionId: { $in: activeAdmIds } }
      ]
    }).countDocuments();

    console.log(`Active (currently admitted) issuances remaining as PENDING/CHARGED TO IPD: ${activeIssuances}`);

    process.exit(0);
  } catch (err) {
    console.error('Migration Error:', err);
    process.exit(1);
  }
}

run();
