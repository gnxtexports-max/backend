import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

async function fixData() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const Shipment = mongoose.model('Shipment', new mongoose.Schema({}, { strict: false }));
    const Invoice = mongoose.model('Invoice', new mongoose.Schema({}, { strict: false }));

    const shipments = await Shipment.find({ status: { $in: ['Delivered', 'Returned', 'Closed'] } });
    let count = 0;

    for (const shipment of shipments) {
      const allInvoiceIds = shipment.destinations?.reduce((acc, dest) => {
        if (dest.invoiceIds?.length) acc.push(...dest.invoiceIds);
        return acc;
      }, []) || [];

      if (allInvoiceIds.length > 0) {
        const result = await Invoice.updateMany(
          { _id: { $in: allInvoiceIds }, status: { $in: ['Pending', 'Assigned', 'In Transit'] } },
          { $set: { status: 'Delivered', deliveredAt: shipment.deliveryDate || new Date() } }
        );
        count += result.modifiedCount;
      }
    }
    console.log('Fixed ' + count + ' invoices.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

fixData();
