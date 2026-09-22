import dotenv from "dotenv";
import { uploadBase64ToR2 } from "../src/services/r2.service.js";

dotenv.config();

async function testR2PodUpload() {
  console.log("Testing base64 POD upload to Cloudflare R2...");
  
  // 1x1 transparent PNG base64
  const testBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const testKey = "pod/SHP-2026-00011_test_upload";

  try {
    const r2Url = await uploadBase64ToR2(testBase64, testKey);
    console.log("✅ Successfully uploaded test POD to R2!");
    console.log("R2 Object URL:", r2Url);
  } catch (err) {
    console.error("❌ Failed R2 POD upload test:", err);
  }
}

testR2PodUpload();
