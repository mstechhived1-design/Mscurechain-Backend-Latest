import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import SupportRequest from './Support/Models/SupportRequest.js';

async function test() {
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const sr = new SupportRequest({
      hospital: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      name: "Test",
      email: "test@test",
      role: "masterhelpdesk",
      subject: "Hello",
      message: "World",
      type: "feedback"
    });
    // simulate pre hooks
    await sr.validate();
    console.log("Validation passed!");
  } catch(e) {
    console.error("Validation failed:", e);
  }
  process.exit();
}
test();
