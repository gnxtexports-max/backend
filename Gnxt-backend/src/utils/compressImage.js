import sharp from "sharp";

const TARGET_BYTES = 400 * 1024;
const MIN_QUALITY = 10;

const COMPRESSIBLE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export function isCompressible(mimeType) {
  return COMPRESSIBLE_TYPES.includes(mimeType);
}

export async function compressImage(input, mimeType) {
  if (!isCompressible(mimeType)) return input;

  if (input.length <= TARGET_BYTES) return input;

  let quality = 80;
  let result;

  do {
    const pipeline = sharp(input).rotate();
    const fmt = mimeType.split("/")[1];
    if (fmt === "png") {
      pipeline.png({ compressionLevel: 9, palette: true });
    } else if (fmt === "webp") {
      pipeline.webp({ quality });
    } else if (fmt === "avif") {
      pipeline.avif({ quality });
    } else {
      pipeline.jpeg({ quality, mozjpeg: true });
    }

    result = await pipeline.toBuffer();
    quality -= 10;
  } while (result.length > TARGET_BYTES && quality >= MIN_QUALITY);

  return result;
}

const DATA_URL_PATTERN = /^data:([^;]+);base64,(.+)$/;

export function isBase64DataUrl(str) {
  return DATA_URL_PATTERN.test(str);
}

export async function compressBase64DataUrl(dataUrl) {
  const match = dataUrl.match(DATA_URL_PATTERN);
  if (!match) return dataUrl;

  const mimeType = match[1];
  if (!isCompressible(mimeType)) return dataUrl;

  const raw = Buffer.from(match[2], "base64");
  if (raw.length <= TARGET_BYTES) return dataUrl;

  const compressed = await compressImage(raw, mimeType);
  const prefix = `data:${mimeType};base64,`;
  return prefix + compressed.toString("base64");
}
