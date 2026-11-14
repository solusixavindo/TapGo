import { inflateRawSync } from "node:zlib";
import { expect } from "vitest";

/** Pembaca zip minimal (direktori pusat) agar isi berkas dapat diperiksa tanpa dependensi. */
export function readZip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const data = buf.subarray(local + 30 + buf.readUInt16LE(local + 26), local + 30 + buf.readUInt16LE(local + 26) + csize);
    expect(method).toBe(8);
    const raw = inflateRawSync(data);
    expect(raw.length).toBe(usize);
    let c = 0xffffffff;
    for (const b of raw) {
      let x = (c ^ b) & 0xff;
      for (let k = 0; k < 8; k += 1) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
      c = x ^ (c >>> 8);
    }
    expect(((c ^ 0xffffffff) >>> 0)).toBe(crc);
    out.set(name, raw.toString("utf8"));
    p += 46 + nlen;
  }
  return out;
}

