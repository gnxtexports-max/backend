import mongoose from "mongoose";
import { autoSeedSuperAdmin } from "../utils/autoSeed.js";
import dns from "dns";

// Set DNS at module load time for SRV record resolution
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

// Prevent unhandled MongoDB driver rejections from crashing the server
process.on("unhandledRejection", (reason) => {
  const msg = reason?.message || "";
  if (msg.includes("Mongo") || msg.includes("mongo") || msg.includes("topology")) {
    console.warn("⚠️ Caught unhandled MongoDB rejection — server continues operating.");
    return;
  }
  console.error("Unhandled Rejection:", reason);
});

// Connection pool options
const connectionOptions = {
  maxPoolSize: 50,
  minPoolSize: 10,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  family: 4,
};

// Asynchronous index verification — runs after connection is established
const createIndexesInBg = async () => {
  try {
    const db = mongoose.connection.db;
    if (!db) return;

    await Promise.all([
      db.collection("invoices").createIndex({ status: 1, invoiceDate: -1, plantReferenceNumber: -1 }),
      db.collection("invoices").createIndex({ plantReferenceNumber: 1, status: 1 }),
      db.collection("shipments").createIndex({ status: 1, createdAt: -1 }),
      db.collection("shipments").createIndex({ "destinations.lrNumber": 1 }),
      db.collection("shipments").createIndex({ "destinations.invoiceIds": 1 }),
      db.collection("shipments").createIndex({ vehicleId: 1, status: 1, dispatchDate: -1 }),
      db.collection("shipments").createIndex({ driverId: 1, status: 1 }),
      db.collection("expenses").createIndex({ category: 1, date: -1 }),
      db.collection("expenses").createIndex({ vehicleNo: 1, date: -1 }),
      db.collection("vehiclelocations").createIndex({ vehicleStatus: 1, fixTime: 1 }),
      db.collection("activitylogs").createIndex({ userId: 1, action: 1, status: 1, createdAt: -1 }),
      db.collection("drivers").createIndex({ phone: 1 }, { unique: true, sparse: true }),
      db.collection("drivers").createIndex({ licenseNumber: 1 }, { unique: true, sparse: true }),
    ]);
    console.log("✅ [Indexes] Production database indexes verified successfully.");
  } catch (idxError) {
    console.warn("⚠️ [Indexes] Background index notice:", idxError.message);
  }
};

const connectDB = async () => {
  try {
    // Suppress MongoDB error events to prevent process crashes & add reconnect logging
    if (!mongoose.connection.listeners("error").length) {
      mongoose.connection.on("error", (err) => {
        console.warn("⚠️ MongoDB connection error suppressed:", err.message.substring(0, 100));
      });

      mongoose.connection.on("disconnected", () => {
        console.warn("⚠️ MongoDB connection lost. Mongoose will attempt automatic reconnection...");
      });

      mongoose.connection.on("reconnected", () => {
        console.log("✅ MongoDB reconnected successfully!");
      });
    }

    const targetUri = process.env.MONGODB_URI;
    if (!targetUri) {
      throw new Error("MONGODB_URI environment variable is required. Server cannot start without database configuration.");
    }

    await mongoose.connect(targetUri, connectionOptions);
    console.log("✅ MongoDB Connected:", targetUri.includes("mongodb+srv") ? "MongoDB Atlas Cloud" : "Local MongoDB Instance");

    // Seed superadmin (idempotent, only creates if absent)
    autoSeedSuperAdmin().catch((err) => console.warn("Auto-seed notice:", err.message));

    // Run index creation asynchronously in background without blocking server boot
    setImmediate(() => {
      createIndexesInBg();
    });

  } catch (error) {
    console.error("❌ DB Connection Error:", error.message);
    throw error;
  }
};

export default connectDB;