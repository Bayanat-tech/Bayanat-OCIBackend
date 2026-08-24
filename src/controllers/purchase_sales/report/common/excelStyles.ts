import * as XLSX from "xlsx";
import { escapeXml } from "./formatters";

const AdmZip = require("adm-zip");

export const COLORS = {
  BLUE: "FF1D4ED8",
  WHITE: "FFFFFFFF",
  GRAY: "FF64748B",
  LBLUE: "FFDBEAFE",
  YELLOW: "FFFFFDE7",
};

const borderThin = (color: string) => ({ style: "thin" as const, color: { rgb: color } });

export const excelStyles = {
  title: {
    font: { bold: true, sz: 14, color: { rgb: COLORS.WHITE } },
    fill: { fgColor: { rgb: COLORS.BLUE } },
    alignment: { horizontal: "center", vertical: "center" },
  },
  label: { font: { sz: 9, color: { rgb: COLORS.GRAY } } },
  value: { font: { bold: true, sz: 9 } },
  header: {
    font: { bold: true, sz: 9, color: { rgb: COLORS.WHITE } },
    fill: { fgColor: { rgb: COLORS.BLUE } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: {
      top: borderThin(COLORS.BLUE),
      bottom: borderThin(COLORS.BLUE),
      left: borderThin(COLORS.BLUE),
      right: borderThin(COLORS.BLUE),
    },
  },
  data: {
    font: { sz: 9 },
    alignment: { vertical: "top" },
    border: { bottom: borderThin("FFE2E8F0") },
  },
  dataNum: {
    font: { sz: 9 },
    alignment: { horizontal: "right", vertical: "top" },
    numFmt: "#,##0.00",
    border: { bottom: borderThin("FFE2E8F0") },
  },
  dataQty: {
    font: { sz: 9 },
    alignment: { horizontal: "right", vertical: "top" },
    numFmt: "#,##0",
    border: { bottom: borderThin("FFE2E8F0") },
  },
  totalLabel: {
    font: { bold: true, sz: 9 },
    fill: { fgColor: { rgb: COLORS.YELLOW } },
  },
  totalNum: {
    font: { bold: true, sz: 9 },
    fill: { fgColor: { rgb: COLORS.YELLOW } },
    alignment: { horizontal: "right" },
    numFmt: "#,##0.00",
  },
  grandLabel: {
    font: { bold: true, sz: 10, color: { rgb: COLORS.WHITE } },
    fill: { fgColor: { rgb: COLORS.BLUE } },
  },
  grandNum: {
    font: { bold: true, sz: 10, color: { rgb: COLORS.WHITE } },
    fill: { fgColor: { rgb: COLORS.BLUE } },
    alignment: { horizontal: "right" },
    numFmt: "#,##0.00",
  },
  meta: { font: { sz: 9, color: { rgb: "FF333333" } } },
  footer: { font: { italic: true, sz: 8, color: { rgb: "FF64748B" } } },
};

interface FontDef {
  bold?: boolean;
  italic?: boolean;
  sz?: number;
  color?: string;
}
interface FillDef {
  color?: string;
}
interface BorderDef {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
}
interface XfDef {
  fontId: number;
  fillId: number;
  borderId: number;
  numFmtId: number;
  align?: string;
  wrap?: boolean;
}

/**
 * Build a styled xlsx Buffer from aoa sheet data + per-cell style maps.
 */
export function buildStyledExcelBuffer(opts: {
  sheetName: string;
  sheetData: any[][];
  rowStyles: Array<Record<number, any>>;
  merges: XLSX.Range[];
  colWidths: number[];
}): Buffer {
  const { sheetName, sheetData, rowStyles, merges, colWidths } = opts;
  const COL_COUNT = colWidths.length;

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!merges"] = merges;
  ws["!cols"] = colWidths.map((wch) => ({ wch }));
  ws["!rows"] = sheetData.map((_, i) => ({ hpt: i === 0 ? 22 : 16 }));

  const fonts: FontDef[] = [{}];
  const fills: FillDef[] = [{}, {}];
  const borders: BorderDef[] = [{}];
  const numFmts: Array<{ id: number; code: string }> = [];
  const cellXfs: XfDef[] = [{ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 }];
  const sigCache = new Map<string, number>();
  let nextCustomNumFmtId = 164;

  const registerFont = (f: any): number => {
    const def: FontDef = {
      bold: !!f?.bold,
      italic: !!f?.italic,
      sz: f?.sz ?? 9,
      color: f?.color?.rgb,
    };
    const key = `font:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    fonts.push(def);
    const idx = fonts.length - 1;
    sigCache.set(key, idx);
    return idx;
  };
  const registerFill = (f: any): number => {
    if (!f?.fgColor?.rgb) return 0;
    const def: FillDef = { color: f.fgColor.rgb };
    const key = `fill:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    fills.push(def);
    const idx = fills.length - 1;
    sigCache.set(key, idx);
    return idx;
  };
  const registerBorder = (b: any): number => {
    if (!b) return 0;
    const def: BorderDef = {
      top: b.top?.color?.rgb,
      bottom: b.bottom?.color?.rgb,
      left: b.left?.color?.rgb,
      right: b.right?.color?.rgb,
    };
    if (!def.top && !def.bottom && !def.left && !def.right) return 0;
    const key = `border:${JSON.stringify(def)}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    borders.push(def);
    const idx = borders.length - 1;
    sigCache.set(key, idx);
    return idx;
  };
  const registerNumFmt = (code?: string): number => {
    if (!code) return 0;
    const existing = numFmts.find((n) => n.code === code);
    if (existing) return existing.id;
    const id = nextCustomNumFmtId++;
    numFmts.push({ id, code });
    return id;
  };
  const registerXf = (styleObj: any): number => {
    if (!styleObj) return 0;
    const fontId = registerFont(styleObj.font);
    const fillId = registerFill(styleObj.fill);
    const borderId = registerBorder(styleObj.border);
    const numFmtId = registerNumFmt(styleObj.numFmt);
    const align = styleObj.alignment?.horizontal;
    const wrap = !!styleObj.alignment?.wrapText;
    const key = `xf:${JSON.stringify({ fontId, fillId, borderId, numFmtId, align, wrap })}`;
    if (sigCache.has(key)) return sigCache.get(key)!;
    cellXfs.push({ fontId, fillId, borderId, numFmtId, align, wrap });
    const idx = cellXfs.length - 1;
    sigCache.set(key, idx);
    return idx;
  };

  const cellStyleIndex = new Map<string, number>();
  sheetData.forEach((row, r) => {
    const styleMap = rowStyles[r] || {};
    row.forEach((_: any, c: number) => {
      if (styleMap[c]) cellStyleIndex.set(`${r},${c}`, registerXf(styleMap[c]));
    });
  });

  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  let sheetXmlData = "";
  for (let r2 = range.s.r; r2 <= range.e.r; r2++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r: r2, c });
      const cell = ws[ref] as XLSX.CellObject | undefined;
      const styleIdx = cellStyleIndex.get(`${r2},${c}`);
      if (!cell && styleIdx === undefined) continue;
      const sAttr = styleIdx !== undefined ? ` s="${styleIdx}"` : "";
      const value = cell?.v;
      if (typeof value === "number") {
        cells.push(`<c r="${ref}"${sAttr}><v>${value}</v></c>`);
      } else if (value !== undefined && value !== null && value !== "") {
        cells.push(
          `<c r="${ref}"${sAttr} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`,
        );
      } else if (styleIdx !== undefined) {
        cells.push(`<c r="${ref}"${sAttr}/>`);
      }
    }
    if (cells.length) sheetXmlData += `<row r="${r2 + 1}">${cells.join("")}</row>`;
  }

  const mergesXml = merges
    .map((m) => `<mergeCell ref="${XLSX.utils.encode_range(m)}"/>`)
    .join("");
  const mergeFinal = merges.length
    ? `<mergeCells count="${merges.length}">${mergesXml}</mergeCells>`
    : "";
  const colsXml = colWidths
    .map((wch, i) => `<col min="${i + 1}" max="${i + 1}" width="${wch}" customWidth="1"/>`)
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="14"/>
  <cols>${colsXml}</cols>
  <sheetData>${sheetXmlData}</sheetData>
  ${mergeFinal}
</worksheet>`;

  const numFmtsXml = numFmts.length
    ? `<numFmts count="${numFmts.length}">${numFmts
        .map((n) => `<numFmt numFmtId="${n.id}" formatCode="${escapeXml(n.code)}"/>`)
        .join("")}</numFmts>`
    : "";

  const fontsXml = `<fonts count="${fonts.length}">${fonts
    .map(
      (f) => `
    <font>
      ${f.sz ? `<sz val="${f.sz}"/>` : '<sz val="9"/>'}
      ${f.color ? `<color rgb="${f.color}"/>` : '<color rgb="FF000000"/>'}
      <name val="Arial"/>
      ${f.bold ? "<b/>" : ""}
      ${f.italic ? "<i/>" : ""}
    </font>`,
    )
    .join("")}
  </fonts>`;

  const fillsXml = `<fills count="${fills.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    ${fills
      .slice(2)
      .map(
        (f) => `
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="${f.color}"/>
        <bgColor rgb="${f.color}"/>
      </patternFill>
    </fill>`,
      )
      .join("")}
  </fills>`;

  const borderEdge = (rgb?: string) => (rgb ? `<color rgb="${rgb}"/>` : "");
  const bordersXml = `<borders count="${borders.length}">${borders
    .map(
      (b) => `
    <border>
      <left style="${b.left ? "thin" : "none"}">${borderEdge(b.left)}</left>
      <right style="${b.right ? "thin" : "none"}">${borderEdge(b.right)}</right>
      <top style="${b.top ? "thin" : "none"}">${borderEdge(b.top)}</top>
      <bottom style="${b.bottom ? "thin" : "none"}">${borderEdge(b.bottom)}</bottom>
      <diagonal/>
    </border>`,
    )
    .join("")}
  </borders>`;

  const cellXfsXml = `<cellXfs count="${cellXfs.length}">${cellXfs
    .map((xf) => {
      const applyAlign = xf.align || xf.wrap;
      return `
    <xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}"
        applyFont="1" applyFill="${xf.fillId ? 1 : 0}" applyBorder="${xf.borderId ? 1 : 0}"
        applyNumberFormat="${xf.numFmtId ? 1 : 0}" applyAlignment="${applyAlign ? 1 : 0}">
      ${
        applyAlign
          ? `<alignment${xf.align ? ` horizontal="${xf.align}"` : ""}${
              xf.wrap ? ` wrapText="1"` : ""
            } vertical="center"/>`
          : ""
      }
    </xf>`;
    })
    .join("")}
  </cellXfs>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${numFmtsXml}
  ${fontsXml}
  ${fillsXml}
  ${bordersXml}
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  ${cellXfsXml}
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes));
  zip.addFile("_rels/.rels", Buffer.from(rels));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml));
  return zip.toBuffer();
}

export function makeSheetBuilder(colCount: number) {
  const sheetData: any[][] = [];
  const merges: XLSX.Range[] = [];
  const rowStyles: Array<Record<number, any>> = [];

  const addRow = (cells: any[], styleMap: Record<number, any>) => {
    while (cells.length < colCount) cells.push("");
    sheetData.push(cells.slice(0, colCount));
    rowStyles.push(styleMap);
  };

  const allStyle = (style: any) =>
    Object.fromEntries(Array.from({ length: colCount }, (_, i) => [i, style]));

  return { sheetData, merges, rowStyles, addRow, allStyle };
}
