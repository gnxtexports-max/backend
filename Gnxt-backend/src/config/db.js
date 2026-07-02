import mongoose from "mongoose";
import { autoSeedSuperAdmin } from "../utils/autoSeed.js";
import dns from "dns";

// Set DNS at module load time for SRV record resolution
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

// Prevent unhandled MongoDB driver rejections from crashing the server
process.on("unhandledRejection", (reason) => {
  const msg = reason?.message || "";
  if (msg.includes("Mongo") || msg.includes("mongo") || msg.includes("topology")) {
    console.warn("⚠️ Caught unhandled MongoDB rejection — server continues in offline mode.");
    return;
  }
  console.error("Unhandled Rejection:", reason);
});

const connectDB = async () => {
  try {
    // Suppress MongoDB error events to prevent process crashes
    mongoose.connection.on("error", (err) => {
      console.warn("⚠️ MongoDB connection error suppressed:", err.message.substring(0, 100));
    });

    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log("MongoDB Connected",process.env.MONGODB_URI);
    await autoSeedSuperAdmin();
  } catch (error) {
    console.error("DB Error:", error.message);
    console.warn("⚠️ Database connection failed. Running server in static/offline mode.");
  }
};

export default connectDB;