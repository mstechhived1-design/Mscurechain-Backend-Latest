import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const mongoUri = process.env.MONGO_URI || "mongodb+srv://curechain:curechain123@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function check() {
    await mongoose.connect(mongoUri);
    console.log("Connected to Mongo");

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const PharmaProfile = mongoose.model('PharmaProfile', new mongoose.Schema({}, { strict: false }));

    const user = await User.findOne({ role: "pharma-owner" });
    console.log("USER DOCUMENT:", JSON.stringify(user, null, 2));

    if (user) {
        const pharma = await PharmaProfile.findOne({ user: user._id });
        console.log("PHARMA PROFILE DOCUMENT:", JSON.stringify(pharma, null, 2));
    }

    await mongoose.disconnect();
}

check();
