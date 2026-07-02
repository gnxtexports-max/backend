require('dotenv').config();

const mongoose = require('mongoose');
async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const Invoice = mongoose.model('Invoice', new mongoose.Schema({}, { strict: false }));
  const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000);
  const invoices = await Invoice.find({
    status: 'Delivered',
    $or: [
      { deliveredAt: { $lt: oneMinuteAgo } },
      { deliveredAt: null, updatedAt: { $lt: oneMinuteAgo } },
      { deliveredAt: { $exists: false }, updatedAt: { $lt: oneMinuteAgo } }
    ]
  });
  console.log('Count:', invoices.length);
  process.exit(0);
}
run();

