const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');

const uri = 'mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function check() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const users = await db.collection('users').find({
    $or: [
      { name: { $regex: 'vinay', $options: 'i' } },
      { email: { $regex: 'vinay', $options: 'i' } }
    ]
  }).toArray();
  console.log('USERS_RESULT:' + JSON.stringify(users.map(u => ({ id: u._id, name: u.name, mobile: u.mobile, email: u.email, role: u.role, hospital: u.hospital }))));

  const allDhruvaUsers = await db.collection('users').find({
    hospital: new mongoose.Types.ObjectId('6a0850656ecbe4898e5d0dfe')
  }).toArray();
  console.log('ALL_DHRUVA_USERS:' + JSON.stringify(allDhruvaUsers.map(u => ({ id: u._id, name: u.name, mobile: u.mobile, role: u.role }))));

  await mongoose.disconnect();
}

check().catch(console.error);
