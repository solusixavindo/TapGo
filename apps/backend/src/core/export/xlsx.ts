import { deflateRawSync } from "node:zlib";

/**
 * Penulis berkas Excel (.xlsx) minimal tanpa dependensi: satu lembar, baris judul tebal dan dibekukan, filter,
 * lebar kolom, angka sebagai angka (dapat dijumlah), tanggal sebagai tanggal sungguhan (WIB).
 *
 * Dibuat sebagai ganti CSV karena Excel berbahasa Indonesia memakai titik koma sebagai pemisah: CSV berkoma
 * terbuka sebagai SATU sel panjang. Sel teks ditulis sebagai teks (inlineStr), bukan rumus, sehingga isi yang
 * diawali "=" tidak pernah dieksekusi dan tidak perlu apostrof penetral seperti pada CSV.
 */
export type XlsxColumn = { header: string; type?: "text" | "number" | "datetime"; width?: number };
export type XlsxCell = string | number | Date | null | undefined;

const WIB_OFFSET_MS = 7 * 3600_000;
const EXCEL_EPOCH_DAYS = 25569; // 1970-01-01 sebagai nomor seri Excel

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Penjaga: karakter kontrol XML tidak sah dibuang, sisanya di-escape. */
function xml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function toSerial(value: Date | string): number | null {
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return null;
  return (ms + WIB_OFFSET_MS) / 86_400_000 + EXCEL_EPOCH_DAYS;
}

function cellXml(ref: string, column: XlsxColumn, value: XlsxCell): string {
  if (value === null || value === undefined || value === "") return "";
  const type = column.type ?? "text";
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(String(value));
    if (Number.isFinite(n)) return `<c r="${ref}" s="2"><v>${n}</v></c>`;
  } else if (type === "datetime") {
    const serial = value instanceof Date || typeof value === "string" ? toSerial(value) : null;
    if (serial !== null) return `<c r="${ref}" s="3"><v>${serial}</v></c>`;
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function sheetXml(columns: XlsxColumn[], rows: XlsxCell[][]): string {
  const lastCol = columnLetter(columns.length - 1);
  const header = columns
    .map((c, i) => `<c r="${columnLetter(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${xml(c.header)}</t></is></c>`)
    .join("");
  const body = rows
    .map((row, r) => {
      const cells = columns.map((c, i) => cellXml(`${columnLetter(i)}${r + 2}`, c, row[i])).join("");
      return `<row r="${r + 2}">${cells}</row>`;
    })
    .join("");
  const cols = columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 18}" customWidth="1"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${Math.max(rows.length + 1, 1)}"/>` +
    `</worksheet>`
  );
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function zip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflated = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nama berkas UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + deflated.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

export function buildXlsx(input: { sheetName: string; columns: XlsxColumn[]; rows: XlsxCell[][] }): Buffer {
  const sheetName = xml(input.sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Laporan");
  const files: Array<{ name: string; data: string }> = [
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
    },
    {
      name: "_rels/.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    },
    {
      name: "xl/workbook.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    },
    { name: "xl/styles.xml", data: STYLES },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml(input.columns, input.rows) }
  ];
  return zip(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, "utf8") })));
}
