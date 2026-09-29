import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Department from '../Lab/Models/Department.js';
import Incident from '../Incident/Models/Incident.js';
import LabSettings from '../Lab/Models/LabSettings.js';
import LabTest from '../Lab/Models/LabTest.js';
import Notification from '../Notification/Models/Notification.js';
import SupportRequest from '../Support/Models/SupportRequest.js';
import TicketSyncQueue from '../Support/Models/TicketSyncQueue.js';
import VitalThreshold from '../IPD/Models/VitalThreshold.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || '';

interface TestResult {
    model: string;
    success: boolean;
    hospitalIdStored: boolean;
    hospitalId?: string;
    documentId?: string;
    error?: string;
}

const results: TestResult[] = [];

async function connectDB() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
}

async function testDepartment(hospitalId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId) {
    try {
        const dept = await Department.create({
            hospital: hospitalId,
            name: 'TEST_Department_Cardiology',
            description: 'Test department for hospital ID verification',
            isActive: true
        });

        const verified = await Department.findById(dept._id);
        const hasHospitalId = (verified as any)?.hospital?.toString() === hospitalId.toString();

        results.push({
            model: 'Department',
            success: true,
            hospitalIdStored: hasHospitalId,
            hospitalId: verified?.hospital?.toString(),
            documentId: dept._id.toString()
        });

        console.log(`✅ Department: Hospital ID ${hasHospitalId ? 'STORED' : 'NOT STORED'}`);

        // Clean up
        await Department.findByIdAndDelete(dept._id);
    } catch (error: any) {
        results.push({
            model: 'Department',
            success: false,
            hospitalIdStored: false,
            error: error.message
        });
        console.log(`❌ Department: ${error.message}`);
    }
}

async function testIncident(hospitalId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId) {
    try {
        const incident = await Incident.create({
            hospital: hospitalId,
            incidentId: 'TEST_INC_001',
            incidentDate: new Date(),
            department: 'TEST_OPD',
            incidentType: 'Test Incident',
            severity: 'Low',
            description: 'Test incident for hospital ID verification',
            reportedBy: userId,
            status: 'OPEN'
        });

        const verified = await Incident.findById(incident._id);
        const hasHospitalId = (verified as any)?.hospital?.toString() === hospitalId.toString();

        results.push({
            model: 'Incident',
            success: true,
            hospitalIdStored: hasHospitalId,
            hospitalId: verified?.hospital?.toString(),
            documentId: incident._id.toString()
        });

        console.log(`✅ Incident: Hospital ID ${hasHospitalId ? 'STORED' : 'NOT STORED'}`);

        // Clean up
        await Incident.findByIdAndDelete(incident._id);
    } catch (error: any) {
        results.push({
            model: 'Incident',
            success: false,
            hospitalIdStored: false,
            error: error.message
        });
        console.log(`❌ Incident: ${error.message}`);
    }
}

async function testLabSettings(hospitalId: mongoose.Types.ObjectId) {
    try {
        const settings = await LabSettings.create({
            hospital: hospitalId,
            name: 'TEST_Lab_Settings',
            tagline: 'Test Lab Settings'
        });

        const verified = await LabSettings.findById(settings._id);
        const hasHospitalId = (verified as any)?.hospital?.toString() === hospitalId.toString();

        results.push({
            model: 'LabSettings',
            success: true,
            hospitalIdStored: hasHospitalId,
            hospitalId: verified?.hospital?.toString(),
            documentId: settings._id.toString()
        });

        console.log(`✅ LabSettings: Hospital ID ${hasHospitalId ? 'STORED' : 'NOT STORED'}`);

        // Clean up
        await LabSettings.findByIdAndDelete(settings._id);
    } catch (error: any) {
        results.push({
            model: 'LabSettings',
            success: false,
            hospitalIdStored: false,
            error: error.message
        });
        console.log(`❌ LabSettings: ${error.message}`);
    }
}

async function testLabTest(hospitalId: mongoose.Types.ObjectId) {
    try {
        const labTest = await LabTest.create({
            hospital: hospitalId,
            testName: 'TEST_Complete_Blood_Count',
            price: 500,
            sampleType: 'Blood',
            isActive: true
        });

        const verified = await LabTest.findById(labTest._id);
        const hasHospitalId = (verified as any)?.hospital?.toString() === hospitalId.toString();

        results.push({
            model: 'LabTest',
            success: true,
            hospitalIdStored: hasHospitalId,
            hospitalId: (verified as any)?.hospital?.toString(),
            documentId: labTest._id.toString()
        });

        console.log(`✅ LabTest: Hospital ID ${hasHospitalId ? 'STORED' : 'NOT STORED'}`);

        // Clean up
        await LabTest.findByIdAndDelete(labTest._id);
    } catch (error: any) {
        results.push({
            model: 'LabTest',
            success: false,
            hospitalIdStored: false,
            error: error.message
        });
        console.log(`❌ LabTest: ${error.message}`);
    }
}

async function testNotification(hospitalId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId) {
    try {
        const notification = await Notification.create({
            hospital: hospitalId,
            recipient: userId,
            type: 'info',
            message: 'Test notification for hospital ID verification',
            isRead: false
        });

        const verified = await Notification.findById(notification._id);
        const hasHospitalId = (verified as any)?.hospital?.toString() === hospitalId.toString();

        results.push({
            model: 'Notification',
            success: true,
            hospitalIdStored: hasHospitalId,
            hospitalId: (verified as any)?.hospital?.toString(),
            documentId: notification._id.toString()
        });

        console.log(`✅ Notification: Hospital ID ${hasHospitalId ? 'STORED' : 'NOT STORED'}`);

        // Clean up
        await Notification.findByIdAndDelete(notification._id);
    } catch (error: any) {
        results.push({
            model: 'Notification',
            success: false,
            hospitalIdStored: false,
            error: error.message
        });
        console.log(`❌ Notification: ${error.message}`);
    }
}

async function testSupportRequest(hospitalId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId) {
    try {
        const supportRequest = await SupportRequest.create({
            hospital: hospitalId,
            userId: userId,
            name: 'Test User',
            role: 'patient',
            subject: 'Test Support Request',
            message: 'Test message for hospital ID verification',
            type: 'feedback',
            status: 'open'
        });

        const verified = await SupportRequest.findById(supportRequest._id);
        const hasHospitalId = (verified as any)?.hospital?.toString() === hospitalId.toString();

        results.push({
            model: 'SupportRequest',
            success: true,
            hospitalIdStored: hasHospitalId,
            hospitalId: (verified as any)?.hospital?.toString(),
            documentId: supportRequest._id.toString()
        });

        console.log(`✅ SupportRequest: Hospital ID ${hasHospitalId ? 'STORED' : 'NOT STORED'}`);

        // Clean up
        await SupportRequest.findByIdAndDelete(supportRequest._id);
    } catch (error: any) {
        results.push({
            model: 'SupportRequest',
            success: false,
            hospitalIdStored: false,
            error: error.message
        });
        console.log(`❌ SupportRequest: ${error.message}`);
    }
}

async function testTicketSyncQueue(hospitalId: mongoose.Types.ObjectId) {
    try {
        const ticketId = new mongoose.Types.ObjectId();

        const queueEntry = await TicketSyncQueue.create({
            hospital: hospitalId,
            ticketId: ticketId,
            payload: { action: 'test', data: 'Test data' },
            retryCount: 0,
            status: 'pending'
        });

        const verified = await TicketSyncQueue.findById(queueEntry._id);
        const hasHospitalId = (verified as any)?.hospital?.toString() === hospitalId.toString();

        results.push({
            model: 'TicketSyncQueue',
            success: true,
            hospitalIdStored: hasHospitalId,
            hospitalId: (verified as any)?.hospital?.toString(),
            documentId: queueEntry._id.toString()
        });

        console.log(`✅ TicketSyncQueue: Hospital ID ${hasHospitalId ? 'STORED' : 'NOT STORED'}`);

        // Clean up
        await TicketSyncQueue.findByIdAndDelete(queueEntry._id);
    } catch (error: any) {
        results.push({
            model: 'TicketSyncQueue',
            success: false,
            hospitalIdStored: false,
            error: error.message
        });
        console.log(`❌ TicketSyncQueue: ${error.message}`);
    }
}

async function testVitalThreshold(hospitalId: mongoose.Types.ObjectId) {
    try {
        const templateId = new mongoose.Types.ObjectId();

        const vitalThreshold = await VitalThreshold.create({
            hospital: hospitalId,
            templateId: templateId,
            vitalName: 'heartRate',
            physicalMin: 30,
            lowerCritical: 40,
            lowerWarning: 50,
            targetMin: 60,
            targetMax: 100,
            upperWarning: 110,
            upperCritical: 140,
            physicalMax: 200,
            unit: 'bpm',
            escalationCriticalMinutes: 5,
            escalationWarningMinutes: 30
        });

        const verified = await VitalThreshold.findById(vitalThreshold._id);
        const hasHospitalId = (verified as any)?.hospital?.toString() === hospitalId.toString();

        results.push({
            model: 'VitalThreshold',
            success: true,
            hospitalIdStored: hasHospitalId,
            hospitalId: (verified as any)?.hospital?.toString(),
            documentId: vitalThreshold._id.toString()
        });

        console.log(`✅ VitalThreshold: Hospital ID ${hasHospitalId ? 'STORED' : 'NOT STORED'}`);

        // Clean up
        await VitalThreshold.findByIdAndDelete(vitalThreshold._id);
    } catch (error: any) {
        results.push({
            model: 'VitalThreshold',
            success: false,
            hospitalIdStored: false,
            error: error.message
        });
        console.log(`❌ VitalThreshold: ${error.message}`);
    }
}

async function runTests() {
    await connectDB();

    const testHospitalId = new mongoose.Types.ObjectId();
    const testUserId = new mongoose.Types.ObjectId();

    console.log('\n🔍 Starting Hospital ID Verification Tests...\n');
    console.log(`📍 Test Hospital ID: ${testHospitalId.toString()}\n`);

    await testDepartment(testHospitalId, testUserId);
    await testIncident(testHospitalId, testUserId);
    await testLabSettings(testHospitalId);
    await testLabTest(testHospitalId);
    await testNotification(testHospitalId, testUserId);
    await testSupportRequest(testHospitalId, testUserId);
    await testTicketSyncQueue(testHospitalId);
    await testVitalThreshold(testHospitalId);

    console.log('\n' + '='.repeat(60));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(60) + '\n');

    const totalTests = results.length;
    const successfulTests = results.filter(r => r.success && r.hospitalIdStored).length;
    const failedTests = results.filter(r => !r.success || !r.hospitalIdStored).length;

    results.forEach(result => {
        const status = result.success && result.hospitalIdStored ? '✅' : '❌';
        console.log(`${status} ${result.model.padEnd(20)} - ${result.success && result.hospitalIdStored ? 'WORKING' : 'FAILED'}`);
        if (result.error) {
            console.log(`   Error: ${result.error}`);
        }
    });

    console.log('\n' + '='.repeat(60));
    console.log(`Total Models Tested: ${totalTests}`);
    console.log(`✅ Working: ${successfulTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    console.log('='.repeat(60));

    if (successfulTests === totalTests) {
        console.log('\n🎉 ALL MODELS ARE CORRECTLY STORING HOSPITAL IDs! 🎉\n');
        console.log('✅ Confidence Level: 100% - Hospital ID field is working correctly\n');
    } else {
        console.log('\n⚠️  SOME MODELS FAILED TO STORE HOSPITAL IDs\n');
        console.log('❌ Please review the errors above\n');
    }

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
}

runTests().catch(error => {
    console.error('❌ Test execution error:', error);
    process.exit(1);
});
