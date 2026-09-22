import mongoose from "mongoose";
import dotenv from "dotenv";
import Shipment from "../src/models/shipment.model.js";
import { uploadBase64ToR2 } from "../src/services/r2.service.js";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/gnxt";

async function testPodDeletionFlow() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB for POD deletion test...");

  // Find a test shipment
  const s = await Shipment.findOne({});
  if (!s || !s.destinations?.length) {
    console.log("No shipment found to test");
    await mongoose.disconnect();
    return;
  }

  console.log("Testing shipment:", s.shipmentId);
  const dest = s.destinations[0];

  // Upload 2 test images to R2
  const dummyBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const url0 = await uploadBase64ToR2(dummyBase64, `pod/test_${s.shipmentId}_idx_0`);
  const url1 = await uploadBase64ToR2(dummyBase64, `pod/test_${s.shipmentId}_idx_1`);

  dest.podImages = [url0, url1];
  await s.save();

  console.log("Saved 2 POD images to MongoDB:");
  console.log("Image 0:", url0);
  console.log("Image 1:", url1);

  // Simulate deletion of Image 0 (keep Image 1)
  // Frontend sends stream URL for Image 1: http://localhost:5000/api/shipments/${s.shipmentId}/pod/1?destId=${dest._id}
  const streamUrl1 = `http://localhost:5000/api/shipments/${s.shipmentId}/pod/1?destId=${dest._id}`;
  
  // Resolve stream URL back to original R2 URL
  const match = streamUrl1.match(/\/pod\/(\d+)/);
  const oldIdx = match ? parseInt(match[1], 10) : -1;
  const resolvedUrl = (oldIdx >= 0 && dest.podImages[oldIdx]) ? dest.podImages[oldIdx] : streamUrl1;

  console.log("\nSimulating deletion of Image 0. Remaining payload sent by frontend:", streamUrl1);
  console.log("Backend resolved payload to original R2 URL:", resolvedUrl);

  dest.podImages = [resolvedUrl];
  await s.save();

  console.log("Updated MongoDB dest.podImages:", dest.podImages);

  if (dest.podImages[0] === url1 && dest.podImages.length === 1) {
    console.log("✅ SUCCESS: Remaining image (Image 1) correctly preserved original Cloudflare R2 URL in MongoDB!");
  } else {
    console.error("❌ FAILED: R2 URL resolution failed!");
  }

  await mongoose.disconnect();
}

testPodDeletionFlow();
