import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import Shipment from "../src/models/shipment.model.js";
import Expense from "../src/models/expense.model.js";
import { uploadToR2 } from "../src/services/r2.service.js";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/gnxt";

async function migrateData() {
  console.log("Starting Migration to Cloudflare R2...");
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB:", MONGODB_URI);

    // 1. Migrate Expenses
    const expenses = await Expense.find({ receiptUrl: { $exists: true, $ne: "" } });
    console.log(`Found ${expenses.length} expenses with receiptUrl.`);

    let expenseMigratedCount = 0;
    for (const exp of expenses) {
      const url = exp.receiptUrl;
      if (!url || url.startsWith("http://") || url.startsWith("https://")) {
        continue; // Already migrated or external URL
      }

      try {
        let buffer = null;
        let mimeType = "image/jpeg";
        let ext = "jpg";

        if (url.startsWith("data:")) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            mimeType = match[1];
            buffer = Buffer.from(match[2], "base64");
            ext = mimeType.split("/")[1] || "jpg";
          }
        } else {
          // Local file path
          const filename = path.basename(url);
          const localPath = path.join(process.cwd(), "uploads", filename);
          if (fs.existsSync(localPath)) {
            buffer = fs.readFileSync(localPath);
            ext = path.extname(filename).replace(".", "") || "jpg";
            mimeType = `image/${ext}`;
          }
        }

        if (buffer) {
          const key = `receipts/migrated_${exp._id}_${Date.now()}.${ext}`;
          const r2Url = await uploadToR2(buffer, key, mimeType);
          exp.receiptUrl = r2Url;
          await exp.save();
          expenseMigratedCount++;
          console.log(`[Expense Migration] Migrated expense ${exp._id} -> ${r2Url}`);
        }
      } catch (err) {
        console.error(`[Expense Migration] Failed for ${exp._id}:`, err.message);
      }
    }

    console.log(`Successfully migrated ${expenseMigratedCount} expense receipts to Cloudflare R2.`);

    // 2. Migrate Shipments POD Images
    const shipments = await Shipment.find({
      $or: [
        { "destinations.podImages": { $exists: true, $not: { $size: 0 } } },
        { podImages: { $exists: true, $not: { $size: 0 } } },
      ],
    });

    console.log(`Found ${shipments.length} shipments with POD images.`);
    let podMigratedCount = 0;

    for (const s of shipments) {
      let shipmentModified = false;

      // Destination level POD images
      if (s.destinations?.length) {
        for (let dIdx = 0; dIdx < s.destinations.length; dIdx++) {
          const dest = s.destinations[dIdx];
          if (dest.podImages?.length) {
            const newPodImages = [];
            for (let pIdx = 0; pIdx < dest.podImages.length; pIdx++) {
              const imgStr = dest.podImages[pIdx];
              if (!imgStr || imgStr.startsWith("http://") || imgStr.startsWith("https://")) {
                newPodImages.push(imgStr);
                continue;
              }

              try {
                let buffer = null;
                let mimeType = "image/jpeg";
                let ext = "jpg";

                if (imgStr.startsWith("data:")) {
                  const match = imgStr.match(/^data:([^;]+);base64,(.+)$/);
                  if (match) {
                    mimeType = match[1];
                    buffer = Buffer.from(match[2], "base64");
                    ext = mimeType.split("/")[1] || "jpg";
                  }
                } else {
                  const filename = path.basename(imgStr);
                  const localPath = path.join(process.cwd(), "uploads", filename);
                  if (fs.existsSync(localPath)) {
                    buffer = fs.readFileSync(localPath);
                    ext = path.extname(filename).replace(".", "") || "jpg";
                    mimeType = `image/${ext}`;
                  }
                }

                if (buffer) {
                  const key = `pod/migrated_${s.shipmentId || s._id}_dest${dIdx}_p${pIdx}_${Date.now()}.${ext}`;
                  const r2Url = await uploadToR2(buffer, key, mimeType);
                  newPodImages.push(r2Url);
                  shipmentModified = true;
                  podMigratedCount++;
                  console.log(`[POD Migration] Migrated Shipment ${s.shipmentId} dest ${dIdx} pod ${pIdx} -> ${r2Url}`);
                } else {
                  newPodImages.push(imgStr);
                }
              } catch (err) {
                console.error(`[POD Migration] Error migrating image:`, err.message);
                newPodImages.push(imgStr);
              }
            }
            dest.podImages = newPodImages;
          }
        }
      }

      // Shipment level POD images (legacy)
      if (s.podImages?.length) {
        const newTopPodImages = [];
        for (let pIdx = 0; pIdx < s.podImages.length; pIdx++) {
          const imgStr = s.podImages[pIdx];
          if (!imgStr || imgStr.startsWith("http://") || imgStr.startsWith("https://")) {
            newTopPodImages.push(imgStr);
            continue;
          }

          try {
            let buffer = null;
            let mimeType = "image/jpeg";
            let ext = "jpg";

            if (imgStr.startsWith("data:")) {
              const match = imgStr.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                mimeType = match[1];
                buffer = Buffer.from(match[2], "base64");
                ext = mimeType.split("/")[1] || "jpg";
              }
            } else {
              const filename = path.basename(imgStr);
              const localPath = path.join(process.cwd(), "uploads", filename);
              if (fs.existsSync(localPath)) {
                buffer = fs.readFileSync(localPath);
                ext = path.extname(filename).replace(".", "") || "jpg";
                mimeType = `image/${ext}`;
              }
            }

            if (buffer) {
              const key = `pod/migrated_${s.shipmentId || s._id}_top_p${pIdx}_${Date.now()}.${ext}`;
              const r2Url = await uploadToR2(buffer, key, mimeType);
              newTopPodImages.push(r2Url);
              shipmentModified = true;
              podMigratedCount++;
              console.log(`[POD Migration] Migrated Shipment ${s.shipmentId} top pod ${pIdx} -> ${r2Url}`);
            } else {
              newTopPodImages.push(imgStr);
            }
          } catch (err) {
            console.error(`[POD Migration] Error migrating top pod image:`, err.message);
            newTopPodImages.push(imgStr);
          }
        }
        s.podImages = newTopPodImages;
      }

      if (shipmentModified) {
        await s.save();
      }
    }

    console.log(`Successfully migrated ${podMigratedCount} POD images to Cloudflare R2.`);
    console.log("Migration complete!");
  } catch (err) {
    console.error("Migration script failed:", err);
  } finally {
    await mongoose.disconnect();
  }
}

migrateData();
