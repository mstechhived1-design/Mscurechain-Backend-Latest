use curechain;

const hospitalId = ObjectId("69a7b003c84f8f6e66180872");
const sampleIds = ["SMP-0186", "SMP-0187"];

const orders = db.laborders.find({ hospital: hospitalId, sampleId: { $in: sampleIds } }).toArray();

print("Found orders:", orders.length);

for (const order of orders) {
    if (order.invoiceId) {
        print("Deleting transaction:", order.invoiceId);
        db.transactions.deleteOne({ _id: order.invoiceId });
    }
    print("Deleting lab order:", order._id);
    db.laborders.deleteOne({ _id: order._id });
}

print("Deletion complete.");
