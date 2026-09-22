import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ Error: MONGODB_URI is not set in environment.");
  process.exit(1);
}

async function runManualMigrations() {
  console.log("🚀 Connecting to database for manual migration...");
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  console.log("▶️ Running Migration 1: Copy glap to flap on invoices...");
  const invRes = await db.collection("invoices").updateMany(
    { glap: { $exists: true }, flap: { $in: [null, 0] } },
    [{ $set: { flap: "$glap" } }]
  );
  console.log(`✅ Migration 1: Modified ${invRes.modifiedCount} invoices.`);

  console.log("▶️ Running Migration 2: Copy totalGlaps to totalFlaps in destinations...");
  const shipmentsToFix = await db.collection("shipments").find({ "destinations.totalGlaps": { $exists: true } }).toArray();
  let shipmentUpdateCount = 0;
  for (const s of shipmentsToFix) {
    let modified = false;
    const updatedDestinations = (s.destinations || []).map(d => {
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
  console.log(`✅ Migration 2: Modified ${shipmentUpdateCount} shipments.`);

  console.log("▶️ Running Migration 3: Sync shipment destination totals with linked invoices...");
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

          const weightDiff = Math.abs((d.weightKg || 0) - totalWeight) > 0.001;
          const tyresDiff = (d.totalTyres || 0) !== totalTyres;
          const tubesDiff = (d.totalTubes || 0) !== totalTubes;
          const flapsDiff = (d.totalFlaps || 0) !== totalFlaps;
          const qtyDiff = (d.totalQuantity || 0) !== totalQuantity;

          if (weightDiff || tyresDiff || tubesDiff || flapsDiff || qtyDiff) {
            d.weightKg = parseFloat(totalWeight.toFixed(2));
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
            totalWeightKg: parseFloat(totalWeightKg.toFixed(2)),
            totalQuantity: totalQuantity
          } 
        }
      );
      shipmentSyncCount++;
    }
  }
  console.log(`✅ Migration 3: Synced ${shipmentSyncCount} shipments.`);

  console.log("▶️ Running Migration 4: Rename status 'Returned - Awaiting' to 'Reassignment'...");
  const statusRes = await db.collection("invoices").updateMany(
    { status: "Returned - Awaiting" },
    { $set: { status: "Reassignment" } }
  );
  console.log(`✅ Migration 4: Modified ${statusRes.modifiedCount} invoices.`);

  console.log("✨ All manual migrations completed successfully.");
  await mongoose.disconnect();
  process.exit(0);
}

runManualMigrations().catch(err => {
  console.error("❌ Migration error:", err);
  process.exit(1);
});
