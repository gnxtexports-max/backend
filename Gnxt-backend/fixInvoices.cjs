
const mongoose = require('mongoose');
async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/gnxt');
  const Shipment = mongoose.model('Shipment', new mongoose.Schema({}, { strict: false }));
  const Invoice = mongoose.model('Invoice', new mongoose.Schema({}, { strict: false }));
  
  const shipments = await Shipment.find({});
  let updatedCount = 0;
  for (const shipment of shipments) {
    const status = shipment.status;
    let invoiceStatus = 'Pending';
    let deliveredAt = null;
    
    if (status === 'In Transit') invoiceStatus = 'In Transit';
    else if (status === 'Delivered' || status === 'Closed' || status === 'Returned') {
       invoiceStatus = 'Delivered';
       deliveredAt = shipment.deliveryDate || shipment.updatedAt || new Date();
    } else if (status === 'Cancelled') {
       invoiceStatus = 'Pending';
    } else {
       invoiceStatus = 'Assigned';
    }
    
    if (invoiceStatus === 'Pending') continue;
    
    const allPlants = (shipment.destinations || []).reduce((acc, dest) => {
       if (dest.plantReferenceNumber) {
         acc.push(...dest.plantReferenceNumber.split(',').map(p => p.trim()).filter(Boolean));
       }
       return acc;
    }, []);
    
    if (allPlants.length) {
       const updateData = { status: invoiceStatus };
       if (invoiceStatus === 'Delivered') updateData.deliveredAt = deliveredAt;
       else updateData.deliveredAt = null;
       
       const res = await Invoice.updateMany({ plantReferenceNumber: { $in: allPlants } }, updateData);
       if (res.modifiedCount > 0) {
           console.log('Fixed', res.modifiedCount, 'invoices for shipment', shipment.shipmentId);
           updatedCount += res.modifiedCount;
       }
    }
  }
  console.log('Total fixed:', updatedCount);
  process.exit(0);
}
run();

