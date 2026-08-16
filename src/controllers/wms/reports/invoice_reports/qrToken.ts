import crypto from "crypto";
import zlib from "zlib";
import QRCode from "qrcode";
import { InvoiceRow } from "./render_html";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  if (!secret || secret.length !== 64) {
    throw new Error("INVOICE_QR_SECRET must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(secret, "hex");
}

/* ------------------------------------------------------------------ */
/*  Self-contained payload — no DB lookup needed on scan               */
/* ------------------------------------------------------------------ */
export interface EmbeddedMeta {
  invoiceNo?: string;
  invoiceDate?: string;
  invoicePeriod?: string;
  clientName?: string;
  clientAddress?: string;
  clientVatNo?: string;
}

export interface InvoiceTokenPayload {
  company_code: string;   // kept only for template selection
  exp: number;            // Unix seconds
  data: InvoiceRow[];     // full invoice rows embedded
  meta: EmbeddedMeta;
}

/* ------------------------------------------------------------------ */
/*  Encrypt: JSON → deflate → AES-256-GCM → base64url                 */
/* ------------------------------------------------------------------ */
export function encryptInvoiceToken(payload: InvoiceTokenPayload): string {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plain = JSON.stringify(payload);
  const compressed = zlib.deflateSync(Buffer.from(plain, "utf8"));

  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

/* ------------------------------------------------------------------ */
/*  Decrypt: base64url → AES-256-GCM → inflate → JSON                 */
/* ------------------------------------------------------------------ */
export function decryptInvoiceToken(token: string): InvoiceTokenPayload | null {
  try {
    const [ivB64, authTagB64, encryptedB64] = token.split(".");
    if (!ivB64 || !authTagB64 || !encryptedB64) return null;

    const key = getKey();
    const iv = Buffer.from(ivB64, "base64url");
    const authTag = Buffer.from(authTagB64, "base64url");
    const encrypted = Buffer.from(encryptedB64, "base64url");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    const decompressed = zlib.inflateSync(decrypted);

    return JSON.parse(decompressed.toString("utf8")) as InvoiceTokenPayload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  QR Code generation via qrcode npm package                          */
/* ------------------------------------------------------------------ */
export async function generateInvoiceQrDataUrl(
  token: string,
  baseUrl: string
): Promise<string> {
  const url = `${baseUrl}/public/invoice?token=${encodeURIComponent(token)}`;

  // Warn if URL is getting too long for reliable scanning
  if (url.length > 2500) {
    console.warn(
      `QR URL is ${url.length} chars. ` +
      `If scanning fails, consider reducing invoice line items.`
    );
  }

  return QRCode.toDataURL(url, {
    width: 100,
    margin: 1,
    errorCorrectionLevel: "L", // "L" = Low, fits more data
    type: "image/png",
  });
}