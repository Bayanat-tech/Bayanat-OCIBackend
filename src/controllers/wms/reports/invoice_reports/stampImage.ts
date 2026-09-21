import fs from "fs";
import path from "path";

/**
 * btlogo.png lives in the SAME folder as this file
 * (src/controllers/wms/reports/invoice_reports/), so no "../" is
 * needed — __dirname already points at that folder at runtime.
 */
const STAMP_IMAGE_URL =
  "https://objectstorage.me-dubai-1.oraclecloud.com/n/axpnrpp1t5qs/b/app-dev-bucket-test/o/COMPANY_LOGO%2FBT_INDIA_STAMP1.png";

// Cached so we don't hit the filesystem on every single request.
let cachedStampDataUrl: string | null = null;
let hasLoggedMissingStamp = false;

/**
 * Reads the stamp image from disk once, converts it to a base64
 * data URI, and caches the result in memory for subsequent calls.
 *
 * Returns "" (and logs once) if the file can't be read, so the
 * invoice templates simply omit the stamp rather than crash.
 */
export function getStampDataUrl(): string {
  return STAMP_IMAGE_URL;
}
 
// export function getStampDataUrl(): string {
//   if (cachedStampDataUrl) return cachedStampDataUrl;

//   try {
//     const fileBuffer = fs.readFileSync(STAMP_FILE_PATH);
//     const ext = path.extname(STAMP_FILE_PATH).slice(1).toLowerCase() || "png";
//     const mimeType = ext === "jpg" ? "jpeg" : ext; // normalize .jpg -> image/jpeg
//     const base64 = fileBuffer.toString("base64");
//     cachedStampDataUrl = `data:image/${mimeType};base64,${base64}`;
//     return cachedStampDataUrl;
//   } catch (err) {
//     if (!hasLoggedMissingStamp) {
//       console.error(
//         "[stampImage] Failed to read stamp image at:",
//         STAMP_FILE_PATH,
//         "\nError:",
//         err
//       );
//       hasLoggedMissingStamp = true;
//     }
//     return "";
//   }
// }

/**
 * Optional: call this if you ever replace the stamp file at runtime
 * (e.g. via an admin upload endpoint) and need the cache to pick up
 * the new file instead of serving the old cached one.
 */
export function clearStampCache(): void {
  cachedStampDataUrl = null;
  hasLoggedMissingStamp = false;
}