export function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function fmtNumber(n: number, decimals = 2): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return n < 0 ? `(${formatted})` : formatted;
}

export function fmtDate(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeXml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build an <img src> value from COMPANY_LOGO only.
 * Supports data URLs, http(s), raw base64, Buffer/BLOB.
 */
export function resolveCompanyLogoSrc(raw: unknown): string {
  if (raw == null) return "";

  if (Buffer.isBuffer(raw)) {
    const b64 = raw.toString("base64");
    const mime =
      raw[0] === 0x89 && raw[1] === 0x50
        ? "image/png"
        : raw[0] === 0xff && raw[1] === 0xd8
          ? "image/jpeg"
          : "image/png";
    return `data:${mime};base64,${b64}`;
  }

  const s = text(raw).trim();
  if (!s) return "";

  if (
    s.startsWith("data:image/") ||
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("/")
  ) {
    return s;
  }

  const looksBase64 = /^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s/g, "").length > 64;
  if (looksBase64) {
    const b64 = s.replace(/\s/g, "");
    let mime = "image/png";
    if (b64.startsWith("/9j/")) mime = "image/jpeg";
    else if (b64.startsWith("R0lG")) mime = "image/gif";
    else if (b64.startsWith("UklG")) mime = "image/webp";
    return `data:${mime};base64,${b64}`;
  }

  return s;
}

/** Simple number-to-words (English) up to millions. */
export function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "Zero";
  const neg = n < 0;
  n = Math.abs(Math.floor(n));

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const chunk = (num: number): string => {
    if (num === 0) return "";
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
    return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " " + chunk(num % 100) : "");
  };

  let result = "";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const remainder = n % 1000;

  if (millions) result += chunk(millions) + " Million";
  if (thousands) result += (result ? " " : "") + chunk(thousands) + " Thousand";
  if (remainder) result += (result ? " " : "") + chunk(remainder);

  return (neg ? "Minus " : "") + (result || "Zero");
}

export function printDateTimeNow(): string {
  return new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
