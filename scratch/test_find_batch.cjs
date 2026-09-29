const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

const { Schema } = mongoose;

const multiTenancyPlugin = require('../dist/middleware/tenantPlugin.js').default;

const productSchema = new Schema({
  sku: { type: String, required: true },
  pharmacy: { type: Schema.Types.ObjectId, required: true },
  hospital: { type: Schema.Types.ObjectId, required: true }
});
productSchema.plugin(multiTenancyPlugin);
const Product = mongoose.model('ProductTest', productSchema, 'products');

const batchSchema = new Schema({
  product: { type: Schema.Types.ObjectId, required: true },
  batchNo: { type: String, required: true },
  pharmacy: { type: Schema.Types.ObjectId, required: true },
  hospital: { type: Schema.Types.ObjectId, required: true }
});
batchSchema.plugin(multiTenancyPlugin);
const Batch = mongoose.model('BatchTest', batchSchema, 'batches');

const { tenantLocalStorage } = require('../dist/middleware/tenantPlugin.js');

async function check() {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    
    const context = {
        tenantId: new mongoose.Types.ObjectId('6a0850656ecbe4898e5d0dfe'), // Hospital
        userId: new mongoose.Types.ObjectId('6a0850436ecbe4898e5d0d82'),
        role: 'pharma-owner',
        isSuperAdmin: false
    };

    await tenantLocalStorage.run(context, async () => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            console.log("Searching inside transaction...");
            const product = await Product.findOne({ 
                sku: 'INTAS', 
                pharmacy: new mongoose.Types.ObjectId('6a0851fd6ecbe4898e5d1437') 
            }).session(session);

            if (product) {
                console.log("Product found:", product._id.toString());
                
                // Query for batch No "D2501634"
                const targetBatchNo = "D2501634";
                const existingBatch = await Batch.findOne({
                    product: product._id,
                    batchNo: targetBatchNo,
                    pharmacy: new mongoose.Types.ObjectId('6a0851fd6ecbe4898e5d1437')
                }).session(session);

                console.log("Query parameters for Batch.findOne:", {
                    product: product._id.toString(),
                    batchNo: targetBatchNo,
                    pharmacy: '6a0851fd6ecbe4898e5d1437'
                });
                
                console.log("existingBatch result:", existingBatch);
            } else {
                console.log("Product not found");
            }
            
            await session.commitTransaction();
        } catch (err) {
            console.error("Error in transaction:", err);
            await session.abortTransaction();
        } finally {
            session.endSession();
        }
    });

    await mongoose.disconnect();
}

check().catch(console.error);
