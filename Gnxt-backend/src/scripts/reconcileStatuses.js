import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env") });

import Shipment from "../models/shipment.model.js";
import Vehicle from "../models/Vehicle.js";
import Driver from "../models/Driver.js";

async function run() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected successfully!");

  console.log("Migrating shipments: 'Returned' -> 'Closed'...");
  const shipMigration = await Shipment.updateMany(
    { status: "Returned" },
    { status: "Closed" }
  );
  console.log(`Successfully migrated ${shipMigration.modifiedCount} shipments.`);

  // Find all shipments that are completed, cancelled, or closed and arrived
  const inactiveShipments = await Shipment.find({
    $or: [
      { status: "Cancelled" },
      { status: "Closed", returnedDate: { $ne: null } }
    ]
  }).lean();

  console.log(`Found ${inactiveShipments.length} completed/inactive shipments in DB.`);

  // Migrate any vehicles with availability: "Assigned" -> "Scheduled"
  console.log("\nMigrating vehicle availability: 'Assigned' -> 'Scheduled'...");
  const migrationResult = await Vehicle.updateMany(
    { availability: "Assigned" },
    { availability: "Scheduled" }
  );
  console.log(`Successfully migrated ${migrationResult.modifiedCount} vehicles.`);

  let vehiclesFreed = 0;
  let driversFreed = 0;

  for (const shipment of inactiveShipments) {
    const vId = shipment.vehicleId?._id || shipment.vehicleId;
    const dId = shipment.driverId?._id || shipment.driverId;

    if (vId) {
      const vehicle = await Vehicle.findById(vId);
      if (vehicle && (vehicle.availability !== "Available" || vehicle.status !== "Idle")) {
        console.log(`Reconciling Vehicle ${vehicle.vehicleNo} from status '${vehicle.status}' / '${vehicle.availability}' -> Idle / Available`);
        vehicle.availability = "Available";
        vehicle.status = "Idle";
        await vehicle.save();
        vehiclesFreed++;
      }
    }

    if (dId) {
      const driver = await Driver.findById(dId);
      if (driver && (driver.tripStatus !== "Idle" || driver.assignedVehicle !== null)) {
        console.log(`Reconciling Driver ${driver.name} from status '${driver.tripStatus}' -> Idle`);
        driver.tripStatus = "Idle";
        driver.assignedVehicle = null;
        await driver.save();
        driversFreed++;
      }
    }
  }

  // Double check: if there are no active (Pending, In Transit, Delivered, Closed) shipments for a vehicle or driver,
  // ensure they are idle as well!
  console.log("\nPerforming double-check validation on all vehicles...");
  const allVehicles = await Vehicle.find({});
  for (const vehicle of allVehicles) {
    const activeShipment = await Shipment.findOne({
      vehicleId: vehicle._id,
      $or: [
        { status: { $in: ["Pending", "In Transit", "Delivered"] } },
        { status: "Closed", $or: [{ returnedDate: { $exists: false } }, { returnedDate: null }] }
      ]
    });
    if (!activeShipment && (vehicle.availability !== "Available" || vehicle.status !== "Idle")) {
      console.log(`Double check: Reconciling Vehicle ${vehicle.vehicleNo} -> Idle / Available (No active shipments found)`);
      vehicle.availability = "Available";
      vehicle.status = "Idle";
      await vehicle.save();
      vehiclesFreed++;
    }
  }

  console.log("\nPerforming double-check validation on all drivers...");
  const allDrivers = await Driver.find({});
  for (const driver of allDrivers) {
    const activeShipment = await Shipment.findOne({
      driverId: driver._id,
      $or: [
        { status: { $in: ["Pending", "In Transit", "Delivered"] } },
        { status: "Closed", $or: [{ returnedDate: { $exists: false } }, { returnedDate: null }] }
      ]
    });
    if (!activeShipment && (driver.tripStatus !== "Idle" || driver.assignedVehicle !== null)) {
      console.log(`Double check: Reconciling Driver ${driver.name} -> Idle (No active shipments found)`);
      driver.tripStatus = "Idle";
      driver.assignedVehicle = null;
      await driver.save();
      driversFreed++;
    }
  }

  console.log(`\nReconciliation summary:`);
  console.log(`- Total vehicles freed: ${vehiclesFreed}`);
  console.log(`- Total drivers freed: ${driversFreed}`);

  console.log("\nDisconnecting from MongoDB...");
  await mongoose.disconnect();
  console.log("Disconnected!");
}

run().catch((err) => {
  console.error("Reconciliation failed:", err);
  process.exit(1);
});
