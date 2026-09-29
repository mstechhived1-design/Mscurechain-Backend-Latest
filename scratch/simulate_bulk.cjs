const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

const { Schema } = mongoose;

const multiTenancyPlugin = require('../dist/middleware/tenantPlugin.js').default;

const productSchema = new Schema({
  sku: { type: String, required: true },
  brand: { type: String, required: true },
  generic: { type: String, required: true },
  stock: { type: Number, default: 0 },
  supplier: { type: Schema.Types.ObjectId },
  pharmacy: { type: Schema.Types.ObjectId, required: true },
  hospital: { type: Schema.Types.ObjectId, required: true }
});
productSchema.plugin(multiTenancyPlugin);
const Product = mongoose.model('ProductSim', productSchema, 'products');

const batchSchema = new Schema({
  product: { type: Schema.Types.ObjectId, required: true },
  batchNo: { type: String, required: true },
  expiry: { type: Date, required: true },
  qtyReceived: { type: Number, required: true },
  qtySold: { type: Number, default: 0 },
  unitCost: { type: Number, required: true },
  supplier: { type: Schema.Types.ObjectId, required: true },
  pharmacy: { type: Schema.Types.ObjectId, required: true },
  hospital: { type: Schema.Types.ObjectId, required: true }
});
batchSchema.plugin(multiTenancyPlugin);
const Batch = mongoose.model('BatchSim', batchSchema, 'batches');

const { tenantLocalStorage } = require('../dist/middleware/tenantPlugin.js');

const productsData = [
  {
    sku: 'INTAS',
    brandName: 'HALD 200 (INTAS)',
    genericName: 'PROGESTERON SOFT GELATIN CAPSULES',
    batchNumber: 'D2501634',
    currentStock: 20,
    mrp: 411.56,
    unitCost: 41,
    expiryDate: '2027-09-01'
  },
  {
    sku: 'INTAS',
    brandName: 'HALD SR 200 (INTAS)',
    genericName: 'PROGESTERON SUSTAINED RELEASE',
    batchNumber: '25S2HTB225',
    currentStock: 10,
    mrp: 420.00,
    unitCost: 45,
    expiryDate: '2027-10-01'
  }
];

async function simulate() {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);

    const pharmacyId = new mongoose.Types.ObjectId('6a0851fd6ecbe4898e5d1437');
    const hospitalId = new mongoose.Types.ObjectId('6a0850656ecbe4898e5d0dfe');

    const context = {
        tenantId: hospitalId,
        userId: new mongoose.Types.ObjectId('6a0851fd6ecbe4898e5d1435'),
        role: 'pharma-owner',
        isSuperAdmin: false
    };

    await tenantLocalStorage.run(context, async () => {
        for (const item of productsData) {
            console.log(`\n--- Processing product: ${item.brandName} ---`);
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const sku = item.sku;
                let query = { sku, pharmacy: pharmacyId };
                
                console.log("Product.findOne query:", query);
                let product = await Product.findOne(query).session(session);
                
                if (product) {
                    console.log("Found product:", product._id.toString(), "Brand in DB:", product.brand);
                } else {
                    console.log("Product not found! Would create new product.");
                }

                const addedStock = Number(item.currentStock) || 0;
                if (addedStock > 0 && product) {
                    let batchSupplier = product.supplier || new mongoose.Types.ObjectId('6a08860112ee21a2a85bb1bc');
                    let expiryDate = new Date(item.expiryDate);
                    const targetBatchNo = (item.batchNumber || "INITIAL").toUpperCase().trim();
                    
                    console.log(`Searching for Batch: product=${product._id.toString()}, batchNo=${targetBatchNo}, pharmacy=${pharmacyId}`);
                    const existingBatch = await Batch.findOne({
                        product: product._id,
                        batchNo: targetBatchNo,
                        pharmacy: pharmacyId,
                    }).session(session);

                    if (existingBatch) {
                        console.log("Found existing batch:", existingBatch._id.toString(), "qtyReceived:", existingBatch.qtyReceived);
                    } else {
                        console.log("Batch NOT found. Would call Batch.create with:", {
                            product: product._id.toString(),
                            batchNo: targetBatchNo,
                            pharmacy: pharmacyId.toString(),
                            hospital: hospitalId.toString()
                        });
                    }
                }
                
                await session.commitTransaction();
            } catch (err) {
                console.error("Error in loop:", err);
                await session.abortTransaction();
            } finally {
                session.endSession();
            }
        }
    });

    await mongoose.disconnect();
}

simulate().catch(console.error);
