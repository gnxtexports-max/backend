const mongoose = require('mongoose');
const path = require('path');

// Load env
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function main() {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    console.log('Connecting to:', uri ? uri.substring(0, 40) + '...' : 'NO URI FOUND');
    await mongoose.connect(uri);

    // Inline Invoice schema (simplified)
    const invoiceSchema = new mongoose.Schema({
      plantReferenceNumber: String,
      invoiceNumber: String,
      customerName: String,
      location: String,
      status: String,
      invoiceDate: Date,
      deliveredAt: Date,
    }, { strict: false });

    const Invoice = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema, 'invoices');

    // 1. Total count
    const total = await Invoice.countDocuments();
    console.log('\n=== Total invoices in DB:', total);

    // 2. Check these specific plant refs from the screenshot
    const testRefs = ['1109461951', '1109461835', '1109461834', '1109461878', '1109461853', '1109461880', '1109461885', '1109461879'];
    const found = await Invoice.find({ plantReferenceNumber: { $in: testRefs } }).lean();
    console.log('\n=== Invoices matching screenshot plant refs:', found.length);
    found.forEach(i => console.log(`  Plant: "${i.plantReferenceNumber}" | Invoice: "${i.invoiceNumber}" | Status: "${i.status}"`));

    // 3. Sample 10 plant refs actually in DB
    const sample = await Invoice.find().limit(10).lean();
    console.log('\n=== Sample plant refs in DB:');
    sample.forEach(i => console.log(`  Plant: "${i.plantReferenceNumber}" | Invoice: "${i.invoiceNumber}" | Status: "${i.status}"`));

    // 4. Count by status
    const statuses = await Invoice.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    console.log('\n=== Invoice count by status:');
    statuses.forEach(s => console.log(`  ${s._id}: ${s.count}`));

    mongoose.disconnect();
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

main();
