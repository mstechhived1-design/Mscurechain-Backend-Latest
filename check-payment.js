import mongoose from "mongoose";

const MONGO_URI = "mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain";

async function checkPayment() {
    try {
        console.log("Connecting to Database...");
        await mongoose.connect(MONGO_URI);
        console.log("Connected!\n");

        const db = mongoose.connection.db;
        const transactionReports = db.collection("transactionreports");

        console.log("Searching for 'RCP-1636923' in ANY field using $regex...\n");
        // Convert to string search across the document (a simple way is using a text search or looking at common fields)
        const reports = await transactionReports.find({
            $or: [
                { "reportData.payments.id": "RCP-1636923" },
                { "reportData.payments.receiptNo": "RCP-1636923" },
                { "reportData.payments.transactionId": "RCP-1636923" }
            ]
        }).toArray();

        console.log(`Found ${reports.length} document(s).\n`);

        reports.forEach((report, index) => {
            console.log(`--- Document ${index + 1} ---`);
            console.log(`_id: ${report._id}`);
            console.log(`Patient ID: ${report.patient}`);
            console.log(`Hospital ID: ${report.hospital}`);
            
            // Just find the exact payment object that has this string
            const matchingPayments = (report.reportData?.payments || []).filter(p => 
                p.id === "RCP-1636923" || p.receiptNo === "RCP-1636923" || p.transactionId === "RCP-1636923"
            );
            
            console.log(`Matching payments count: ${matchingPayments.length}`);
            console.log("Payment Details:");
            console.log(JSON.stringify(matchingPayments, null, 2));
            console.log("------------------------\n");
        });

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected.");
    }
}

checkPayment();
