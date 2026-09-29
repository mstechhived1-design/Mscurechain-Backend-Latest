const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

async function check() {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    
    const PharmaProfiles = mongoose.connection.collection('pharmaprofiles');
    const Users = mongoose.connection.collection('users');

    // Find the pharma profile
    const profile = await PharmaProfiles.findOne({ _id: new mongoose.Types.ObjectId('6a0851fd6ecbe4898e5d1437') });
    console.log("PharmaProfile Details:\n", JSON.stringify(profile, null, 2));

    if (profile && profile.user) {
        // Find the user document
        const user = await Users.findOne({ _id: profile.user });
        console.log("\nUser Details:\n", JSON.stringify(user, null, 2));
    } else {
        console.log("No user found on PharmaProfile");
    }

    await mongoose.disconnect();
}

check().catch(console.error);
