import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI;
  console.log("Attempting to connect to:", uri);
  try {
    await mongoose.connect(uri);
    console.log("✅ MongoDB Connection Successful!");
    
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log("Available Collections:", collections.map(c => c.name));
    
    // Check drivers collection
    try {
      const driversCount = await db.collection("drivers").countDocuments();
      console.log(`Drivers Count: ${driversCount}`);
      const sampleDrivers = await db.collection("drivers").find().limit(3).toArray();
      console.log("Sample Drivers:", JSON.stringify(sampleDrivers, null, 2));
    } catch (e) {
      console.error("Error reading drivers collection:", e.message);
    }
    
    // Check vehicles collection
    try {
      const vehiclesCount = await db.collection("vehicles").countDocuments();
      console.log(`Vehicles Count: ${vehiclesCount}`);
      const sampleVehicles = await db.collection("vehicles").find().limit(3).toArray();
      console.log("Sample Vehicles:", JSON.stringify(sampleVehicles, null, 2));
    } catch (e) {
      console.error("Error reading vehicles collection:", e.message);
    }
    
    // Check users collection (to see if correctly connected)
    try {
      const usersCount = await db.collection("users").countDocuments();
      console.log(`Users Count: ${usersCount}`);
    } catch (e) {
      console.error("Error reading users collection:", e.message);
    }

  } catch (err) {
    console.error("❌ Connection failed:", err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
