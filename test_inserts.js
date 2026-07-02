import mongoose from "mongoose";
import dotenv from "dotenv";
import Driver from "./src/models/Driver.js";
import Vehicle from "./src/models/Vehicle.js";

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI;
  console.log("Connecting to:", uri);
  try {
    await mongoose.connect(uri);
    console.log("✅ Connected!");

    // Let's try inserting a dummy driver
    const driverData = {
      name: "Test Driver " + Date.now(),
      age: 30,
      phone: "9" + Math.floor(100000000 + Math.random() * 900000000),
      licenseNumber: "DL-" + Math.floor(100000 + Math.random() * 900000),
      driverType: "Own",
      tripStatus: "Idle"
    };

    try {
      const newDriver = new Driver(driverData);
      const savedDriver = await newDriver.save();
      console.log("✅ Driver inserted successfully:", savedDriver._id);
      
      // Cleanup
      await Driver.findByIdAndDelete(savedDriver._id);
      console.log("✅ Test Driver cleaned up.");
    } catch (err) {
      console.error("❌ Driver insertion failed:", err);
    }

    // Let's try inserting a dummy vehicle
    // Find latest vehicle
    const lastVehicle = await Vehicle.findOne().sort({ createdAt: -1 });
    let nextNumber = 1;
    if (lastVehicle && lastVehicle.vehicleId) {
      const lastNumber = parseInt(lastVehicle.vehicleId.split("-")[1]);
      nextNumber = lastNumber + 1;
    }
    const vehicleId = `VEH-${String(nextNumber).padStart(3, "0")}`;

    const vehicleData = {
      vehicleId,
      vehicleNo: "MH-12-TX-" + Math.floor(1000 + Math.random() * 9000),
      type: "Truck",
      model: "Tata Ultra",
      capacityKg: 5000,
      ownership: "Company",
      gpsImei: "",
      status: "Idle",
      availability: "Available"
    };

    try {
      const newVehicle = new Vehicle(vehicleData);
      const savedVehicle = await newVehicle.save();
      console.log("✅ Vehicle inserted successfully:", savedVehicle._id);

      // Cleanup
      await Vehicle.findByIdAndDelete(savedVehicle._id);
      console.log("✅ Test Vehicle cleaned up.");
    } catch (err) {
      console.error("❌ Vehicle insertion failed:", err);
    }

  } catch (err) {
    console.error("❌ Connection failed:", err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
