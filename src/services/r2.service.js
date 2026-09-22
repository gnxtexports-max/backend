import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "gnxt-images";
const R2_ENDPOINT = process.env.R2_ENDPOINT || (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "");
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || (R2_ENDPOINT ? `${R2_ENDPOINT}/${R2_BUCKET_NAME}` : "");

export const s3Client = (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT)
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

/**
 * Delete an object from Cloudflare R2 bucket by URL or object key
 * @param {string} urlOrKey - Full R2 public URL or relative object key
 */
export async function deleteFromR2(urlOrKey) {
  if (!urlOrKey || typeof urlOrKey !== "string") return;
  if (!s3Client) {
    console.warn("[Cloudflare R2] Skipping delete: R2 storage client is not configured.");
    return;
  }
  try {
    let key = urlOrKey;
    if (urlOrKey.startsWith("http://") || urlOrKey.startsWith("https://")) {
      const urlObj = new URL(urlOrKey);
      key = urlObj.pathname.replace(/^\/gnxt-images\//, "").replace(/^\//, "");
    }
    if (!key || key.startsWith("data:")) return;

    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });
    await s3Client.send(command);
    console.log(`[Cloudflare R2] Successfully deleted object: ${key}`);
  } catch (err) {
    console.error(`[Cloudflare R2] Delete failed for key/url ${urlOrKey}:`, err.message);
  }
}

/**
 * Upload a binary buffer to Cloudflare R2
 * @param {Buffer} buffer - Image file buffer
 * @param {string} key - R2 key (e.g. "pod/shipmentId_destId_1700000.jpg")
 * @param {string} contentType - MIME type (e.g. "image/jpeg")
 * @returns {Promise<string>} Public URL of the uploaded image
 */
export async function uploadToR2(buffer, key, contentType = "image/jpeg") {
  if (!s3Client) {
    console.warn("[Cloudflare R2] Cannot upload: R2 credentials are not configured in environment.");
    throw new Error("R2 storage is not configured. Please set R2 credentials in environment.");
  }
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
 * Fetch a raw file buffer (image or PDF) from Cloudflare R2, HTTP, or local disk
 * @param {string} input - URL, key, base64 data URL, or local path
 * @returns {Promise<{ buffer: Buffer, contentType: string } | null>}
 */
export async function getFileBuffer(input) {
  if (!input || typeof input !== "string") return null;

  try {
    let rawBuffer = null;
    let contentType = "application/octet-stream";

    if (input.startsWith("data:")) {
      const match = input.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        contentType = match[1];
        rawBuffer = Buffer.from(match[2], "base64");
      }
    } else if (input.startsWith("http://") || input.startsWith("https://")) {
      // If it's an R2 URL, fetch via S3 GetObject using key with bucket credentials
      const urlObj = new URL(input);
      const key = urlObj.pathname.replace(/^\/gnxt-images\//, "").replace(/^\//, "");
      if (key && (input.includes("r2.cloudflarestorage.com") || input.includes("r2.dev"))) {
        try {
          const getCmd = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key });
          const r2Res = await s3Client.send(getCmd);
          const chunks = [];
          for await (const chunk of r2Res.Body) {
            chunks.push(chunk);
          }
          rawBuffer = Buffer.concat(chunks);
          contentType = r2Res.ContentType || (key.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
        } catch (s3Err) {
          console.warn("[getFileBuffer] S3 GetObject failed, trying fetch fallback:", s3Err.message);
        }
      }

      if (!rawBuffer) {
        const res = await fetch(input);
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          rawBuffer = Buffer.from(arrayBuf);
          contentType = res.headers.get("content-type") || "application/octet-stream";
        }
      }
    } else {
      // Local disk file fallback
      const filename = path.basename(input);
      const sourcePath = path.join(process.cwd(), "uploads", filename);
      if (fs.existsSync(sourcePath)) {
        rawBuffer = fs.readFileSync(sourcePath);
        contentType = filename.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
      }
    }

    if (!rawBuffer) return null;

    // Detect MIME type from extension if generic
    if (contentType === "application/octet-stream") {
      if (input.toLowerCase().includes(".pdf")) contentType = "application/pdf";
      else if (input.toLowerCase().includes(".png")) contentType = "image/png";
      else if (input.toLowerCase().includes(".webp")) contentType = "image/webp";
      else if (input.toLowerCase().includes(".jpg") || input.toLowerCase().includes(".jpeg")) contentType = "image/jpeg";
    }

    return { buffer: rawBuffer, contentType };
  } catch (err) {
    console.error(`[getFileBuffer] Failed to get file (${input.slice(0, 50)}...):`, err.message);
    return null;
  }
}

/**
 * Fetch or decode an image into a Buffer for ExcelJS embedding.
 * Handles base64 data URLs, Cloudflare R2 URLs, local disk files, and S3 GetObject fallback.
 * Automatically converts WebP to PNG/JPEG for seamless Microsoft Excel compatibility.
 * @param {string} input - URL, key, base64 data URL, or local path
 * @returns {Promise<{ buffer: Buffer, extension: 'jpeg' | 'png', isPdf?: boolean, pdfUrl?: string } | null>}
 */
export async function fetchImageForExcel(input) {
  if (!input || typeof input !== "string") return null;

  if (imageFetchCache.has(input)) {
    return imageFetchCache.get(input);
  }

  try {
    const file = await getFileBuffer(input);
    if (!file || !file.buffer) return null;

    const { buffer: rawBuffer, contentType: mimeType } = file;

    // Handle PDF files cleanly
    if (mimeType.includes("pdf") || input.toLowerCase().includes(".pdf")) {
      const pdfResult = { isPdf: true, pdfUrl: input, buffer: rawBuffer };
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
