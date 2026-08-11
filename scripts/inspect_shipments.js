import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import dns from "dns";
import { fileURLToPath } from "url";

dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

async function run() {
  try {
    const uri = process.env.MONGODB_URI;
    console.log("Connecting to MongoDB Atlas...");
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log("Connected successfully.");

    const db = mongoose.connection.db;
    const shipmentsCol = db.collection("shipments");

    // 1. Total documents in shipments collection
    const totalDocs = await shipmentsCol.countDocuments({});
    console.log("==========================================");
    console.log("TOTAL SHIPMENT DOCUMENTS IN DB:", totalDocs);
    console.log("==========================================");

    // Get all documents to inspect dates, statuses, fields
    const allShipments = await shipmentsCol.find({}).sort({ createdAt: -1 }).toArray();

    // Group by status
    const statusCounts = {};
    allShipments.forEach((doc) => {
      const s = doc.status || "UNKNOWN";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    console.log("\nShipment Count by Status:", JSON.stringify(statusCounts, null, 2));

    // History condition on frontend: status === "Cancelled" || status === "Closed"
    const historyDocsFrontendCondition = allShipments.filter(
      (doc) => doc.status === "Cancelled" || doc.status === "Closed"
    );
    console.log("Docs matching Frontend History Condition (status === 'Cancelled' || status === 'Closed'):", historyDocsFrontendCondition.length);

    // Let's also check if there are other status values like "Delivered", "In Transit", "Pending"
    const deliveredDocs = allShipments.filter((doc) => doc.status === "Delivered");
    console.log("Docs with status Delivered:", deliveredDocs.length);

    // Date cutoff: August 8, 2026 (2026-08-08T00:00:00.000Z)
    const cutoffDate = new Date("2026-08-08T00:00:00.000Z");

    const beforeAug8 = allShipments.filter((doc) => {
      const d = doc.createdAt || doc.deliveryDate || doc.dispatchDate;
      const date = d ? new Date(d) : null;
      return date && date < cutoffDate;
    });

    const afterOrOnAug8 = allShipments.filter((doc) => {
      const d = doc.createdAt || doc.deliveryDate || doc.dispatchDate;
      const date = d ? new Date(d) : null;
      return date && date >= cutoffDate;
    });

    const noDateDocs = allShipments.filter((doc) => {
      return !doc.createdAt && !doc.deliveryDate && !doc.dispatchDate;
    });

    console.log("\n--- DATE ANALYSIS (Cutoff: Aug 8, 2026) ---");
    console.log("Records with ANY date BEFORE Aug 8, 2026:", beforeAug8.length);
    console.log("Records with ANY date ON/AFTER Aug 8, 2026:", afterOrOnAug8.length);
    console.log("Records with NO date field:", noDateDocs.length);

    // Let's inspect status distribution for records before Aug 8 vs after Aug 8
    const statusBeforeAug8 = {};
    beforeAug8.forEach((doc) => {
      const s = doc.status || "UNKNOWN";
      statusBeforeAug8[s] = (statusBeforeAug8[s] || 0) + 1;
    });
    console.log("Status distribution BEFORE Aug 8, 2026:", JSON.stringify(statusBeforeAug8));

    const statusAfterAug8 = {};
    afterOrOnAug8.forEach((doc) => {
      const s = doc.status || "UNKNOWN";
      statusAfterAug8[s] = (statusAfterAug8[s] || 0) + 1;
    });
    console.log("Status distribution ON/AFTER Aug 8, 2026:", JSON.stringify(statusAfterAug8));

    // Detailed check of all documents
    console.log("\n--- ALL SHIPMENTS DETAILS ---");
    allShipments.forEach((doc, idx) => {
      const d = doc.createdAt || doc.deliveryDate || doc.dispatchDate;
      console.log(`[${idx + 1}] ID: ${doc.shipmentId || doc._id} | Status: ${doc.status} | CreatedAt: ${doc.createdAt} | DeliveryDate: ${doc.deliveryDate} | Vehicle: ${doc.vehicleNumber} | Destinations: ${doc.destinations?.length || 0}`);
    });

    // Check collections in DB
    const collections = await db.listCollections().toArray();
    console.log("\nAll Collections in DB:", collections.map(c => c.name));

  } catch (err) {
    console.error("Error running script:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected.");
  }
}

run();
