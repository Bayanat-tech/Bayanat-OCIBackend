import * as XLSX from "xlsx";
import { ReportRow } from "../common/types";
import { extractHeader, extractLines, calcTotals, currencyLabel } from "../common/extract";
import { numberToWords, printDateTimeNow } from "../common/formatters";
import { buildStyledExcelBuffer, excelStyles, makeSheetBuilder } from "../common/excelStyles";

/**
 * Delivery Note – Excel exporter
 */
export function buildDnExcelBuffer(rows: ReportRow[], loginId: string): Buffer {
  const header = extractHeader(rows);
  const lines = extractLines(rows);
  const COL_COUNT = 6;
  const { sheetData, merges, rowStyles, addRow, allStyle } = makeSheetBuilder(COL_COUNT);
  const styles = excelStyles;
  const printDateTime = printDateTimeNow();

  const titleR = sheetData.length;
  addRow(["DELIVERY NOTE", ...Array(COL_COUNT - 1).fill("")], allStyle(styles.title));
  merges.push({ s: { r: titleR, c: 0 }, e: { r: titleR, c: COL_COUNT - 1 } });

  addRow(
    [`Print Date: ${printDateTime}`, "", `Print User: ${loginId}`, "", "", ""],
    { 0: styles.meta, 2: styles.meta },
  );
  addRow(Array(COL_COUNT).fill(""), {});

  if (!header) {
    addRow(["No data found for the given document."], { 0: styles.value });
  } else {
    addRow([`To: ${header.party_name}`, "", "", `DN No.: ${header.doc_no}`, "", ""], {
      0: styles.value,
      3: styles.value,
    });
    const addr =
      header.party_address ||
      [header.cust_add1, header.cust_add2, header.cust_add3].filter(Boolean).join(" ");
    addRow([addr, "", "", `Date: ${header.doc_date}`, "", ""], {
      0: styles.data,
      3: styles.value,
    });
    addRow(
      [
        `Tel: ${header.party_phone}  Fax: ${header.party_fax}`,
        "",
        "",
        `A/C Code: ${header.ac_code}`,
        "",
        "",
      ],
      { 0: styles.data, 3: styles.value },
    );
    addRow(
      [
        `Mob: ${header.cust_mobile || header.dlvr_mobile}  Email: ${header.cust_email || header.dlvr_email}`,
        "",
        "",
        `Payment Term: ${header.payment_terms}`,
        "",
        "",
      ],
      { 0: styles.data, 3: styles.value },
    );
    addRow(["", "", "", `Sold By: ${header.user_id}`, "", ""], { 3: styles.value });
    addRow(["", "", "", `Delivery To: ${header.delivery_to}`, "", ""], { 3: styles.value });

    if (header.cancelled === "Y") {
      addRow(
        ["*** CANCELLED DOCUMENT ***", ...Array(COL_COUNT - 1).fill("")],
        allStyle(styles.grandLabel),
      );
      merges.push({
        s: { r: sheetData.length - 1, c: 0 },
        e: { r: sheetData.length - 1, c: COL_COUNT - 1 },
      });
    }

    addRow(Array(COL_COUNT).fill(""), {});

    addRow(
      ["S.No.", "Product / Description", "Unit", "Qty", "Unit Rate", "Gross Value"],
      allStyle(styles.header),
    );

    lines.forEach((l, idx) => {
      const desc = l.det_remarks
        ? `${l.prod_code} - ${l.prod_name}\n${l.det_remarks}`
        : `${l.prod_code} - ${l.prod_name}`;
      addRow(
        [idx + 1, desc, l.p_uom, l.quantity, l.unit_price, l.amount],
        {
          0: { ...styles.data, alignment: { horizontal: "center", vertical: "top" } },
          1: styles.data,
          2: { ...styles.data, alignment: { horizontal: "center", vertical: "top" } },
          3: styles.dataQty,
          4: styles.dataNum,
          5: styles.dataNum,
        },
      );
    });

    if (!lines.length) {
      addRow(["", "No line items", "", "", "", ""], { 1: styles.data });
    }

    addRow(Array(COL_COUNT).fill(""), {});

    const { totalQty, totalAmount, overallDiscount, grandTotal } = calcTotals(
      lines,
      header.disc_hdr_price,
    );
    const amountInWords = `${currencyLabel(header.curr_code)} - ${numberToWords(grandTotal)} only`;

    addRow(
      [`Total Quantity: ${totalQty}`, "", "", "Total Amount:", totalAmount, ""],
      { 0: styles.totalLabel, 3: styles.totalLabel, 4: styles.totalNum },
    );
    addRow(["", "", "", "Overall Discount:", overallDiscount, ""], {
      3: styles.totalLabel,
      4: styles.totalNum,
    });
    addRow(["", "", "", "Grand Total:", grandTotal, ""], {
      3: styles.grandLabel,
      4: styles.grandNum,
    });

    addRow([amountInWords, ...Array(COL_COUNT - 1).fill("")], { 0: styles.value });
    merges.push({
      s: { r: sheetData.length - 1, c: 0 },
      e: { r: sheetData.length - 1, c: COL_COUNT - 1 },
    });

    if (header.remarks) {
      addRow([`Remarks: ${header.remarks}`, ...Array(COL_COUNT - 1).fill("")], { 0: styles.data });
      merges.push({
        s: { r: sheetData.length - 1, c: 0 },
        e: { r: sheetData.length - 1, c: COL_COUNT - 1 },
      });
    }

    addRow(Array(COL_COUNT).fill(""), {});
    addRow(
      ["Prepared By", "Checked By", "Delivered By", "Receiver's Name & Signature", "", ""],
      { 0: styles.label, 1: styles.label, 2: styles.label, 3: styles.label },
    );
  }

  addRow(["", "", "", "", "", "Powered by Bayanat Technology"], { 5: styles.footer });

  return buildStyledExcelBuffer({
    sheetName: "Delivery Note",
    sheetData,
    rowStyles,
    merges,
    colWidths: [8, 42, 10, 10, 12, 14],
  });
}
