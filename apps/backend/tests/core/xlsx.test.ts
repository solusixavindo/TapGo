import { describe, expect, it } from "vitest";
import { buildXlsx } from "../../src/core/export/xlsx.js";
import { readZip } from "../helpers/zipReader.js";

describe("buildXlsx", () => {
  const files = readZip(
    buildXlsx({
      sheetName: "data/pengguna?",
      columns: [{ header: "Nama" }, { header: "Telepon" }, { header: "Saldo", type: "number" }, { header: "Tanggal", type: "datetime" }],
      rows: [
        ['=HYPERLINK("x") <b>&Sri', "+6281234567890", "1250000.50", "2026-11-14T04:30:00.000Z"],
        ["Budi \u0001Santoso", "", "bukan angka", "bukan tanggal"]
      ]
    })
  );

  it("memuat bagian wajib paket Excel dengan CRC dan ukuran yang benar", () => {
    expect([...files.keys()].sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].sort()
    );
  });

  it("setiap kolom menjadi sel sendiri (bukan satu sel panjang), judul tebal dan dibekukan", () => {
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    for (const ref of ["A1", "B1", "C1", "D1", "A2", "B2", "C2", "D2"]) expect(sheet).toContain(`r="${ref}"`);
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:D3"/>');
  });

  it("angka dan tanggal tersimpan sebagai angka/tanggal (WIB), teks tidak pernah menjadi rumus", () => {
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="C2" s="2"><v>1250000.5</v></c>');
    // 2026-11-14 11:30 WIB = serial 46340.479166...
    expect(sheet).toMatch(/<c r="D2" s="3"><v>46340\.47916/);
    expect(sheet).toContain("=HYPERLINK(&quot;x&quot;) &lt;b&gt;&amp;Sri");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">Budi Santoso</t></is></c>');
    // Nilai yang tidak dapat dibaca sebagai angka/tanggal jatuh kembali menjadi teks, bukan merusak berkas.
    expect(sheet).toContain("bukan angka");
    expect(sheet).toContain("bukan tanggal");
  });

  it("nama lembar dibersihkan dari karakter terlarang", () => {
    expect(files.get("xl/workbook.xml")).toContain('name="data pengguna "');
  });
});
