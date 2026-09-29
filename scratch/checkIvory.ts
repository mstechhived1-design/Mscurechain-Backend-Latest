import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const HospitalSchema = new mongoose.Schema({
    name: String,
});
const Hospital = mongoose.model('Hospital', HospitalSchema);

const DoctorProfileSchema = new mongoose.Schema({
    hospital: mongoose.Schema.Types.ObjectId,
});
const DoctorProfile = mongoose.model('DoctorProfile', DoctorProfileSchema);

async function checkIvoryDental() {
    await mongoose.connect(process.env.MONGO_URI!);
    const hospital = await Hospital.findOne({ name: /IVORY DENTAL/i });
    if (!hospital) {
        console.log('Hospital not found');
        process.exit(0);
    }
    console.log('Hospital ID:', hospital._id);
    const doctorCount = await DoctorProfile.countDocuments({ hospital: hospital._id });
    console.log('Doctor Count:', doctorCount);
    process.exit(0);
}

checkIvoryDental();
