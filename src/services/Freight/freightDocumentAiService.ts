// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse");

// ISO 6346 character value weights (letters skip multiples of 11: 11, 22, 33)
const ISO6346_CHAR_VALUES: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

/**
 * Validates an 11-character ISO 6346 container number using standard check-digit formula.
 */
export function isIso6346Valid(containerNo: string): boolean {
  if (!containerNo) return false;
  const clean = containerNo.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (clean.length !== 11) return false;

  let total = 0;
  for (let i = 0; i < 10; i++) {
    const val = ISO6346_CHAR_VALUES[clean[i]] ?? 0;
    total += val * Math.pow(2, i);
  }
  const remainder = total % 11;
  const expected = remainder === 10 ? 0 : remainder;
  return clean[10] === String(expected);
}

export interface ExtractedContainer {
  container_no: string;
  seal_no?: string;
  size?: string;
  is_valid_iso: boolean;
}

export interface ParsedDocumentResult {
  detected_type: "CFS_TRANSFER" | "BILL_OF_LADING" | "AIR_WAYBILL" | "CUSTOMS_BAYAN" | "GENERAL_SHIPPING";
  bl_number: string | null;
  transfer_request_number: string | null;
  invoice_number: string | null;
  containers: ExtractedContainer[];
  container_count: number;
  status: string | null;
  status_ok: boolean;
  port_name: string | null;
  port_code: string | null;
  suggested_job_type: "CFS" | "IMP" | "EXP";
  suggested_transport_mode: "SEA" | "AIR" | "LAND";
  raw_text_snippet: string;
}

const CFS_TRANSFER_VALID_STATUS = "PENDING GATE RECEIVE FOR TRANSFER";

export async function parseShippingDocumentPdf(fileBuffer: Buffer): Promise<ParsedDocumentResult> {
  let text = "";
  if (typeof pdfParse === "function") {
    const pdfData = await pdfParse(fileBuffer);
    text = pdfData.text || "";
  } else if (pdfParse && typeof pdfParse.PDFParse === "function") {
    const parser = new pdfParse.PDFParse({ data: fileBuffer });
    const res = await parser.getText();
    text = res.text || "";
    if (typeof parser.destroy === "function") {
      await parser.destroy();
    }
  }

  const upper = text.toUpperCase();
  const collapsed = upper.replace(/\s+/g, " ");
  const despaced = upper.replace(/\s+/g, "");

  // 1. Detect Document Type
  let detectedType: ParsedDocumentResult["detected_type"] = "GENERAL_SHIPPING";
  let suggestedJobType: ParsedDocumentResult["suggested_job_type"] = "IMP";
  let suggestedMode: ParsedDocumentResult["suggested_transport_mode"] = "SEA";

  if (upper.includes("TRANSFER REQUEST") || despaced.includes("PENDINGGATERECEIVEFORTRANSFER") || upper.includes("TRANSPORT DOCUMENTS FOR TRANSFER")) {
    detectedType = "CFS_TRANSFER";
    suggestedJobType = "CFS";
    suggestedMode = "SEA";
  } else if (upper.includes("AIR WAYBILL") || upper.includes("HAWB") || upper.includes("MAWB")) {
    detectedType = "AIR_WAYBILL";
    suggestedJobType = "IMP";
    suggestedMode = "AIR";
  } else if (upper.includes("BAYAN") || upper.includes("CUSTOMS DECLARATION") || upper.includes("BILL OF ENTRY")) {
    detectedType = "CUSTOMS_BAYAN";
    suggestedJobType = "IMP";
    suggestedMode = "SEA";
  } else if (upper.includes("BILL OF LADING") || upper.includes("OCEAN BILL") || upper.includes("SEA WAYBILL")) {
    detectedType = "BILL_OF_LADING";
    suggestedJobType = "IMP";
    suggestedMode = "SEA";
  }

  // 2. Extract B/L Number
  let blNumber: string | null = null;

  // A: Oman eCustoms Transfer Request format: "S.No BL Date" e.g. "1 MEDUO9505266 2026/01/31"
  const ecustomsBlMatch = upper.match(/\b\d{1,3}\s+([A-Z0-9]{6,25})\s+\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/);
  if (ecustomsBlMatch) {
    blNumber = ecustomsBlMatch[1].trim();
  }

  // B: Carrier prefix match (MEDU, MSKU, MAEU, HLCU, ONEY, CMAU, COSU, etc.)
  if (!blNumber) {
    const carrierMatch = upper.match(/\b((?:MEDU|MSKU|MAEU|HLCU|ONEY|CMAU|COSU|EGLV|APLU|OOCU|YMLU|ZIMU)[A-Z0-9]{6,14})\b/);
    if (carrierMatch) {
      blNumber = carrierMatch[1].trim();
    }
  }

  // C: Generic "B/L NO" or "Bill of Lading" label match
  if (!blNumber) {
    const genericBlMatch = upper.match(/(?:B\/?L\s*(?:NO|NUMBER)?|BILL\s*OF\s*LADING|WAYBILL)[\s:#]*([A-Z0-9\-_]{6,25})/);
    if (genericBlMatch) {
      blNumber = genericBlMatch[1].trim();
    }
  }

  // 3. Extract Transfer Request Number / Invoice Ref
  let transferRequestNumber: string | null = null;
  const trMatch = upper.match(/TRANSFER\s+REQUEST\s+NUMBER[\s:]*([A-Z0-9\-_]{5,30})/);
  if (trMatch) {
    transferRequestNumber = trMatch[1].trim();
  }

  // Invoice Number
  let invoiceNumber: string | null = transferRequestNumber;
  if (!invoiceNumber) {
    const invMatch = upper.match(/(?:INVOICE|COMMERCIAL\s*INVOICE)\s*(?:NO|NUMBER)?[\s:#]*([A-Z0-9\-_]{4,25})/);
    if (invMatch) {
      invoiceNumber = invMatch[1].trim();
    }
  }

  // 4. Extract Containers (ISO 6346)
  const containers: ExtractedContainer[] = [];
  const seenContainers = new Set<string>();

  // ISO regex: 3 letters + U/J/Z + 6 digits + 1 check digit
  const containerRegex = /([A-Z]{3}[UJZ])[ -]?(\d{6})(\d)(?!\d)/g;
  let match: RegExpExecArray | null;

  while ((match = containerRegex.exec(upper)) !== null) {
    const candidate = `${match[1]}${match[2]}${match[3]}`;
    if (!seenContainers.has(candidate)) {
      seenContainers.add(candidate);
      const valid = isIso6346Valid(candidate);
      containers.push({
        container_no: candidate,
        is_valid_iso: valid,
        size: "40", // Default to 40HC/40GP unless specified
      });
    }
  }

  // 5. Status Evaluation
  let statusOk = false;
  let statusText: string | null = null;

  if (detectedType === "CFS_TRANSFER") {
    const targetStatusDespaced = CFS_TRANSFER_VALID_STATUS.replace(/\s+/g, "");
    if (despaced.includes(targetStatusDespaced)) {
      statusOk = true;
      statusText = "Pending Gate Receive for Transfer";
    } else {
      const statusMatch = upper.match(/STATUS\s*:?\s*([A-Z][A-Z /]{3,60})/);
      statusText = statusMatch ? statusMatch[1].trim() : "Unknown / Not Verified";
      statusOk = false;
    }
  } else {
    statusOk = true;
    statusText = "Document Ready";
  }

  // 6. Port Detection
  let portCode: string | null = null;
  let portName: string | null = null;

  if (collapsed.includes("SOHAR") || collapsed.includes("OMSOH")) {
    portCode = "SOH";
    portName = "Sohar Port";
  } else if (collapsed.includes("SALALAH") || collapsed.includes("OMSLL")) {
    portCode = "SLL";
    portName = "Salalah Port";
  } else if (collapsed.includes("MUSCAT") || collapsed.includes("OMMCT") || collapsed.includes("SULTAN QABOOS")) {
    portCode = "MCT";
    portName = "Port Sultan Qaboos (Muscat)";
  } else if (collapsed.includes("DUQM") || collapsed.includes("OMDQM")) {
    portCode = "DQM";
    portName = "Port of Duqm";
  }

  return {
    detected_type: detectedType,
    bl_number: blNumber,
    transfer_request_number: transferRequestNumber,
    invoice_number: invoiceNumber,
    containers,
    container_count: containers.length,
    status: statusText,
    status_ok: statusOk,
    port_code: portCode,
    port_name: portName,
    suggested_job_type: suggestedJobType,
    suggested_transport_mode: suggestedMode,
    raw_text_snippet: collapsed.substring(0, 300),
  };
}
