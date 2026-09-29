import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = 'mongodb+srv://admin:curechain_admin@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function check() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected');
  
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  
  const ramu = await User.findOne({ mobile: '9199999999' }) as any;
  console.log('Ramunaidu Match:', ramu ? { id: ramu._id, name: ramu.name, role: ramu.role, mobile: ramu.mobile } : 'None');

  const mani = await User.findOne({ mobile: '6546546544' }) as any;
  console.log('Manikanta Match:', mani ? { id: mani._id, name: mani.name, role: mani.role, mobile: mani.mobile } : 'None');

  const allWithRamuMobile = await User.find({ mobile: '9199999999' }) as any[];
  console.log('All with 9199999999:', allWithRamuMobile.map(u => ({ id: u._id, name: u.name, role: u.role })));

  await mongoose.disconnect();
}

check().catch(console.error);
