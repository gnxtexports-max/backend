import mongoose from "mongoose";
import dotenv from "dotenv";
import Shipment from "./src/models/shipment.model.js";
import Invoice from "./src/models/invoice.model.js";

dotenv.config();

const ATLAS_URI = "mongodb+srv://gnxt_admin:gnxt%40123@cluster0.zkzxzxo.mongodb.net/gnxt?retryWrites=true&w=majority&appName=Cluster0";

const run = async () => {
  try {
    await mongoose.connect(ATLAS_URI);
    console.log("Connected to MongoDB Atlas");

    const shipments = await Shipment.find().lean();
    console.log(`Analyzing ${shipments.length} shipments...`);

    let mismatchCount = 0;

    for (const shp of shipments) {
      for (const d of shp.destinations) {
        if (!d.invoiceIds || d.invoiceIds.length === 0) continue;

        const invoices = await Invoice.find({ _id: { $in: d.invoiceIds } }).lean();
        const invoiceWeightSum = invoices.reduce((sum, inv) => sum + (Number(inv.weight) || 0), 0);
        const diff = Math.abs(d.weightKg - invoiceWeightSum);

        if (diff > 1.0) {
          mismatchCount++;
          console.log(`\n[Mismatch] Shipment: ${shp.shipmentId} | LR: ${d.lrNumber} | Customer: ${d.customerName}`);
          console.log(`  Destination weight: ${d.weightKg} | Invoice weight sum: ${invoiceWeightSum} | Diff: ${diff}`);
          console.log(`  Invoices:`);
          invoices.forEach(inv => {
            console.log(`    Invoice: ${inv.invoiceNumber} | Plant: ${inv.plantReferenceNumber} | Tyre: ${inv.tyre} | Tube: ${inv.tube} | Flap: ${inv.flap} | Weight: ${inv.weight}`);
          });
        }
      }
    }

    console.log(`\nTotal mismatch shipments found: ${mismatchCount}`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
};

run();
