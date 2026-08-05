import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "f425b5c41fab5d68eccf71a2b75ea12f";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "29ca495b8c44550a7651386ec7defa0a";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "4f1161591d58d8efb60405344b7043dedd924d8d0aee8010cfd05d7b45454514";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "gnxt-images";
const R2_ENDPOINT = process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `${R2_ENDPOINT}/${R2_BUCKET_NAME}`;

export const s3Client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload a binary buffer to Cloudflare R2
 * @param {Buffer} buffer - Image file buffer
 * @param {string} key - R2 key (e.g. "pod/shipmentId_destId_1700000.jpg")
 * @param {string} contentType - MIME type (e.g. "image/jpeg")
 * @returns {Promise<string>} Public URL of the uploaded image
 */
export async function uploadToR2(buffer, key, contentType = "image/jpeg") {
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await s3Client.send(command);

    // Format public URL
    const publicUrl = `${R2_PUBLIC_URL.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
    console.log(`[Cloudflare R2] Successfully uploaded: ${key} -> ${publicUrl}`);
    return publicUrl;
  } catch (err) {
    console.error(`[Cloudflare R2] Upload failed for key ${key}:`, err.message);
    throw new Error(`R2 Upload Failed: ${err.message}`);
  }
}

/**
 * Helper: Upload a base64 Data URL to Cloudflare R2
 * @param {string} dataUrl - e.g. "data:image/jpeg;base64,..."
 * @param {string} keyPrefix - e.g. "pod/shipment123" or "receipts/exp456"
 * @returns {Promise<string>} Cloudflare R2 URL or original URL if not base64
 */
export async function uploadBase64ToR2(dataUrl, keyPrefix) {
  if (!dataUrl || typeof dataUrl !== "string") return "";

  // If already an R2 or HTTP URL, return as-is
  if (dataUrl.startsWith("http://") || dataUrl.startsWith("https://")) {
    return dataUrl;
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;

  const contentType = match[1] || "image/jpeg";
  const rawBuffer = Buffer.from(match[2], "base64");

  // Determine file extension
  const extMap = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
  const ext = extMap[contentType] || "jpg";
  const uniqueKey = `${keyPrefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;

  return await uploadToR2(rawBuffer, uniqueKey, contentType);
}

// In-memory cache for Excel export session deduplication
const imageFetchCache = new Map();

/**
 * Fetch or decode an image into a Buffer for ExcelJS embedding.
 * Handles base64 data URLs, Cloudflare R2 URLs, local disk files, and S3 GetObject fallback.
 * Automatically converts WebP to PNG/JPEG for seamless Microsoft Excel compatibility.
 * @param {string} input - URL, key, base64 data URL, or local path
 * @returns {Promise<{ buffer: Buffer, extension: 'jpeg' | 'png' } | null>}
 */
export async function fetchImageForExcel(input) {
  if (!input || typeof input !== "string") return null;

  if (imageFetchCache.has(input)) {
    return imageFetchCache.get(input);
  }

  try {
    let rawBuffer = null;
    let mimeType = "image/jpeg";

    if (input.startsWith("data:")) {
      const match = input.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        rawBuffer = Buffer.from(match[2], "base64");
      }
    } else if (input.startsWith("http://") || input.startsWith("https://")) {
      // Try HTTP fetch first
      const res = await fetch(input);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        rawBuffer = Buffer.from(arrayBuf);
        mimeType = res.headers.get("content-type") || "image/jpeg";
      } else {
        // Fallback: If HTTP fetch fails (e.g. non-public R2 bucket endpoint), try S3 GetObject using key
        const urlObj = new URL(input);
        const key = urlObj.pathname.replace(/^\/gnxt-images\//, "").replace(/^\//, "");
        if (key) {
          const getCmd = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key });
          const r2Res = await s3Client.send(getCmd);
          const chunks = [];
          for await (const chunk of r2Res.Body) {
            chunks.push(chunk);
          }
          rawBuffer = Buffer.concat(chunks);
          mimeType = r2Res.ContentType || "image/jpeg";
        }
      }
    } else {
      // Local disk file fallback
      const filename = path.basename(input);
      const sourcePath = path.join(process.cwd(), "uploads", filename);
      if (fs.existsSync(sourcePath)) {
        rawBuffer = fs.readFileSync(sourcePath);
      }
    }

    if (!rawBuffer) return null;

    // Handle PDF files cleanly
    if (mimeType.includes("pdf") || input.toLowerCase().includes(".pdf")) {
      const pdfResult = { isPdf: true, pdfUrl: input };
      imageFetchCache.set(input, pdfResult);
      return pdfResult;
    }

    // ExcelJS supports jpeg and png best. Convert WebP or others to PNG/JPEG via Sharp.
    let finalBuffer = rawBuffer;
    let extension = "jpeg";

    if (mimeType.includes("png")) {
      extension = "png";
    } else if (mimeType.includes("webp") || mimeType.includes("avif")) {
      // Convert WebP/AVIF to JPEG buffer for Excel compatibility
      finalBuffer = await sharp(rawBuffer).jpeg({ quality: 85 }).toBuffer();
      extension = "jpeg";
    } else {
      extension = "jpeg";
    }

    const result = { buffer: finalBuffer, extension };
    imageFetchCache.set(input, result);
    return result;
  } catch (err) {
    console.error(`[fetchImageForExcel] Failed to process image (${input.slice(0, 50)}...):`, err.message);
    return null;
  }
}

/**
 * Clear the export image cache after an export completes
 */
export function clearImageExportCache() {
  imageFetchCache.clear();
}
