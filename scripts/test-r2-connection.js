import { uploadToR2, s3Client } from "../src/services/r2.service.js";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

async function testR2() {
  console.log("Testing Cloudflare R2 connection...");
  try {
    const listCmd = new ListObjectsV2Command({ Bucket: "gnxt-images", MaxKeys: 5 });
    const res = await s3Client.send(listCmd);
    console.log("R2 Connection Successful! Objects count:", res.KeyCount || 0);

    const dummyBuffer = Buffer.from("Hello Cloudflare R2 Test", "utf-8");
    const testUrl = await uploadToR2(dummyBuffer, "test/connection_test.txt", "text/plain");
    console.log("Test File Uploaded URL:", testUrl);
  } catch (err) {
    console.error("R2 Connection Failed:", err);
  }
}

testR2();
