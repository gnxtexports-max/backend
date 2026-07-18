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

    // Run self-healing migration for glap -> flap, totalGlaps -> totalFlaps, and sync shipment totals with invoices
    try {
      const db = mongoose.connection.db;
      
      // 1. Invoices: Copy glap value to flap if glap exists and flap is missing or default 0
      const invRes = await db.collection("invoices").updateMany(
        { glap: { $exists: true }, flap: { $in: [null, 0] } },
        [{ $set: { flap: "$glap" } }]
      );
      if (invRes.modifiedCount > 0) {
        console.log(`[Migration] Migrated ${invRes.modifiedCount} invoices (copied glap to flap)`);
      }

      // 2. Shipments: Copy totalGlaps to totalFlaps in destinations array
      const shipmentsToFix = await db.collection("shipments").find({ "destinations.totalGlaps": { $exists: true } }).toArray();
      let shipmentUpdateCount = 0;
      for (const s of shipmentsToFix) {
        let modified = false;
        const updatedDestinations = s.destinations.map(d => {
          if (d.totalGlaps !== undefined && d.totalFlaps === undefined) {
            d.totalFlaps = d.totalGlaps;
            modified = true;
          }
          return d;
        });
        if (modified) {
          await db.collection("shipments").updateOne(
            { _id: s._id },
            { $set: { destinations: updatedDestinations } }
          );
          shipmentUpdateCount++;
        }
      }
      if (shipmentUpdateCount > 0) {
        console.log(`[Migration] Migrated ${shipmentUpdateCount} shipments (copied totalGlaps to totalFlaps)`);
      }

      // 3. Shipments: Sync all shipment destination totals with their linked invoices
      const allShipments = await db.collection("shipments").find({}).toArray();
      let shipmentSyncCount = 0;
      for (const s of allShipments) {
        let modified = false;
        const updatedDestinations = await Promise.all((s.destinations || []).map(async (d) => {
          if (d.invoiceIds && d.invoiceIds.length > 0) {
            const invoices = await db.collection("invoices").find({ _id: { $in: d.invoiceIds } }).toArray();
            if (invoices.length > 0) {
              const totalWeight = invoices.reduce((sum, inv) => sum + (Number(inv.weight) || 0), 0);
              const totalTyres = invoices.reduce((sum, inv) => sum + (Number(inv.tyre) || 0), 0);
              const totalTubes = invoices.reduce((sum, inv) => sum + (Number(inv.tube) || 0), 0);
              const totalFlaps = invoices.reduce((sum, inv) => sum + (Number(inv.flap) || 0), 0);
              const totalQuantity = totalTyres + totalTubes + totalFlaps;

              // Check if any value is different
              const weightDiff = Math.abs((d.weightKg || 0) - totalWeight) > 0.05;
              const tyresDiff = (d.totalTyres || 0) !== totalTyres;
              const tubesDiff = (d.totalTubes || 0) !== totalTubes;
              const flapsDiff = (d.totalFlaps || 0) !== totalFlaps;
              const qtyDiff = (d.totalQuantity || 0) !== totalQuantity;

              if (weightDiff || tyresDiff || tubesDiff || flapsDiff || qtyDiff) {
                d.weightKg = parseFloat(totalWeight.toFixed(1));
                d.totalTyres = totalTyres;
                d.totalTubes = totalTubes;
                d.totalFlaps = totalFlaps;
                d.totalQuantity = totalQuantity;
                modified = true;
              }
            }
          }
          return d;
        }));

        if (modified) {
          const totalWeightKg = updatedDestinations.reduce((sum, d) => sum + (Number(d.weightKg) || 0), 0);
          const totalQuantity = updatedDestinations.reduce((sum, d) => sum + (Number(d.totalQuantity) || 0), 0);

          await db.collection("shipments").updateOne(
            { _id: s._id },
            { 
              $set: { 
                destinations: updatedDestinations,
                totalWeightKg: parseFloat(totalWeightKg.toFixed(1)),
                totalQuantity: totalQuantity
              } 
            }
          );
          shipmentSyncCount++;
        }
      }
      if (shipmentSyncCount > 0) {
        console.log(`[Migration] Synced ${shipmentSyncCount} shipments with their correct invoice totals`);
      }
    } catch (migError) {
      console.warn("⚠️ [Migration] Failed to run database auto-migration:", migError.message);
    }
  } catch (error) {
    console.error("DB Error:", error.message);
    console.warn("⚠️ Database connection failed. Running server in static/offline mode.");
  }
};

export default connectDB;