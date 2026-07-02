import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env") });

import Expense from "../models/expense.model.js";
import Shipment from "../models/shipment.model.js";

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB for backfill...");

  const expenses = await Expense.find({}).lean();
  console.log(`Found ${expenses.length} total expenses. Processing...`);

  let updatedCount = 0;
  for (const exp of expenses) {
    let resolvedTripId = exp.tripId || "";

    if (!resolvedTripId) {
      // Try to find shipment by shipmentId ObjectId
      if (exp.shipmentId) {
        const s = await Shipment.findById(exp.shipmentId).select("shipmentId").lean();
        if (s?.shipmentId) {
          resolvedTripId = s.shipmentId;
        }
      }
      
      // Fallback: try to find by lrNumber
      if (!resolvedTripId && exp.lrNumber) {
        const s = await Shipment.findOne({ "destinations.lrNumber": exp.lrNumber })
          .select("shipmentId")
          .lean();
        if (s?.shipmentId) {
          resolvedTripId = s.shipmentId;
        }
      }

      if (resolvedTripId) {
        await Expense.findByIdAndUpdate(exp._id, { tripId: resolvedTripId });
        console.log(`Updated Expense ${exp._id} -> Set tripId to ${resolvedTripId}`);
        updatedCount++;
      } else {
        console.log(`Could not resolve tripId for Expense ${exp._id}`);
      }
    }
  }

  console.log(`Backfill complete. Updated ${updatedCount} expenses.`);
  await mongoose.disconnect();
}

run().catch(console.error);
