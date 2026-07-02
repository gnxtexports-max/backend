import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("MONGO_URI not set in environment");
  process.exit(1);
}

async function createIndexes() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const db = mongoose.connection.db;

    // Invoices indexes
    await db.collection("invoices").createIndex({ plantReferenceNumber: 1, status: 1 });
    console.log("✓ Index: invoices on (plantReferenceNumber, status)");

    await db.collection("invoices").createIndex({ status: 1, updatedAt: 1 });
    console.log("✓ Index: invoices on (status, updatedAt)");

    await db.collection("invoices").createIndex({ plantReferenceNumber: 1 });
    console.log("✓ Index: invoices on (plantReferenceNumber)");

    // Shipments indexes
    await db.collection("shipments").createIndex({ status: 1, vehicleNumber: 1 });
    console.log("✓ Index: shipments on (status, vehicleNumber)");

    await db.collection("shipments").createIndex({ createdAt: -1 });
    console.log("✓ Index: shipments on (createdAt: -1)");

    await db.collection("shipments").createIndex({ "destinations.plantReferenceNumber": 1 });
    console.log("✓ Index: shipments on (destinations.plantReferenceNumber)");

    await db.collection("shipments").createIndex({ shipmentId: 1 });
    console.log("✓ Index: shipments on (shipmentId)");

    // Vehicle indexes
    await db.collection("vehicles").createIndex({ vehicleNo: 1 });
    console.log("✓ Index: vehicles on (vehicleNo)");

    // Driver indexes
    await db.collection("drivers").createIndex({ phone: 1 });
    console.log("✓ Index: drivers on (phone)");

    console.log("\nAll indexes created successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Error creating indexes:", err);
    process.exit(1);
  }
}

createIndexes();
