import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env") });

import Shipment from "../models/shipment.model.js";

async function backfill() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI is not defined in environment variables");
    process.exit(1);
  }

  console.log("Attempting to connect to:", uri);
  try {
    await mongoose.connect(uri);
    console.log("✅ MongoDB Connection Successful!");

    // Fetch all shipments, sorted by createdAt/shipmentId ascending
    const shipments = await Shipment.find().sort({ createdAt: 1, shipmentId: 1 });
    console.log(`Found ${shipments.length} shipments to process.`);

    const yearCounters = {};

    for (const shipment of shipments) {
      // Resolve year from shipmentId (e.g., SHP-2026-00001) or createdAt or current year
      let year = new Date().getFullYear();
      if (shipment.shipmentId) {
        const parts = shipment.shipmentId.split("-");
        if (parts.length >= 2 && !isNaN(parseInt(parts[1], 10))) {
          year = parseInt(parts[1], 10);
        }
      } else if (shipment.createdAt) {
        year = shipment.createdAt.getFullYear();
      }

      if (!yearCounters[year]) {
        yearCounters[year] = 1;
      }

      console.log(`Processing shipment ${shipment.shipmentId || shipment._id} (Year: ${year})...`);

      for (let i = 0; i < shipment.destinations.length; i++) {
        const seq = yearCounters[year];
        const newLr = `LR-${year}-${String(seq).padStart(5, "0")}`;
        const oldLr = shipment.destinations[i].lrNumber;
        
        shipment.destinations[i].lrNumber = newLr;
        yearCounters[year]++;
        
        console.log(`  Destination ${i + 1}: ${oldLr || "N/A"} ➔ ${newLr}`);
      }

      // We use save() to trigger save logic if needed, but we bypass isNew check in pre-save so it updates correctly
      // Wait, mongoose pre-save hook only runs generateShipmentId/assignSequentialLRNumbers if this.isNew is true.
      // Since this is an existing shipment, it will not overwrite our assigned LR numbers.
      await shipment.save();
      console.log(`✅ Saved shipment ${shipment.shipmentId || shipment._id}`);
    }

    console.log("\n🎉 Backfill completed successfully!");
    console.log("Counters per year:", yearCounters);

  } catch (err) {
    console.error("❌ Backfill failed:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

backfill();
