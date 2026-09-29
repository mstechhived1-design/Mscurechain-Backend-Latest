import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

import User from './Auth/Models/User.js';

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI || '');
    console.log('Connected to DB');

    const doctorUser = await (User.findOne({ role: 'doctor' }) as any).unscoped().lean();
    if (!doctorUser) {
      console.log('No doctor found');
      process.exit(1);
    }

    const token = jwt.sign({ 
        _id: doctorUser._id, 
        role: doctorUser.role,
        hospitalId: doctorUser.hospital 
    }, process.env.JWT_SECRET || '');

    console.log('Testing /api/bookings/my-appointments');
    const res = await fetch('http://localhost:5003/api/bookings/my-appointments', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const text = await res.text();
    console.log('STATUS:', res.status);
    console.log('RESPONSE:', text);

    console.log('Testing /api/ipd/admissions/active');
    const res2 = await fetch('http://localhost:5003/api/ipd/admissions/active', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const text2 = await res2.text();
    console.log('STATUS 2:', res2.status);
    console.log('RESPONSE 2:', text2);

    process.exit(0);
  } catch(e) {
    console.error('Crash:', e);
    process.exit(1);
  }
}
run();
