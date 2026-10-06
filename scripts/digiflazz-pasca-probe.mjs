#!/usr/bin/env node
// Pemeriksaan pascabayar Digiflazz, hanya-baca dan aman dijalankan di VPS.
//
// Mencetak: (1) jumlah produk pascabayar per brand (jawaban "layanan pascabayar
// apa saja yang tersedia di akun ini"), (2) contoh nama PDAM dan BPJS, dan
// (3) BENTUK respons satu cek tagihan MODE UJI (testing=true, nomor uji resmi
// Digiflazz; tidak memotong saldo) berupa nama kunci dan tipe, bukan isinya.
//
// Kredensial dibaca dari berkas .env backend (argumen --env <jalur>) atau dari
// lingkungan (DIGIFLAZZ_USERNAME, DIGIFLAZZ_API_KEY) dan TIDAK PERNAH dicetak.
// Pemakaian di VPS:
//   node digiflazz-pasca-probe.mjs --env /var/www/releases/<rilis aktif>/apps/backend/.env
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const envFlag = process.argv.indexOf("--env");
if (envFlag !== -1 && process.argv[envFlag + 1]) {
  // Hanya dua kunci yang diambil; berkas tidak di-source oleh shell.
  const wanted = new Set(["DIGIFLAZZ_USERNAME", "DIGIFLAZZ_API_KEY", "DIGIFLAZZ_BASE_URL"]);
  for (const line of readFileSync(process.argv[envFlag + 1], "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && wanted.has(match[1]) && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}

const username = process.env.DIGIFLAZZ_USERNAME;
const apiKey = process.env.DIGIFLAZZ_API_KEY;
const base = (process.env.DIGIFLAZZ_BASE_URL ?? "https://api.digiflazz.com/v1").replace(/\/$/, "");
if (!username || !apiKey) {
  console.error("DIGIFLAZZ_USERNAME dan DIGIFLAZZ_API_KEY harus ada di lingkungan.");
  process.exit(1);
}

const md5 = (text) => createHash("md5").update(text).digest("hex");
async function post(path, body) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    return { status: 0, json: { data: { message: `tidak terhubung (${error.name})` } } };
  }
  let json = null;
  try { json = await response.json(); } catch { /* bukan JSON */ }
  return { status: response.status, json };
}

function shape(value, depth = 0) {
  if (Array.isArray(value)) return value.length ? [shape(value[0], depth + 1)] : [];
  if (value && typeof value === "object") {
    if (depth > 3) return "object";
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]));
  }
  return value === null ? "null" : typeof value;
}

// 1) Daftar harga pascabayar
const list = await post("/price-list", { cmd: "pasca", username, sign: md5(`${username}${apiKey}pricelist`) });
const rows = Array.isArray(list.json?.data) ? list.json.data : null;
if (!rows) {
  console.log(`Daftar harga pascabayar ditolak (HTTP ${list.status}). Bentuk respons:`);
  console.log(JSON.stringify(shape(list.json)));
  const info = list.json?.data && !Array.isArray(list.json.data) ? list.json.data : list.json;
  console.log(`rc=${info?.rc ?? "?"} pesan=${info?.message ?? "?"}`);
} else {
  const byBrand = {};
  for (const row of rows) byBrand[row.brand ?? "(tanpa brand)"] = (byBrand[row.brand ?? "(tanpa brand)"] ?? 0) + 1;
  console.log(`Total produk pascabayar: ${rows.length}`);
  console.log("Per brand:");
  for (const [brand, count] of Object.entries(byBrand).sort((a, b) => b[1] - a[1])) console.log(`  ${brand}: ${count}`);
  const pick = (re) => rows.filter((r) => re.test(`${r.brand} ${r.product_name}`)).slice(0, 5);
  console.log("Contoh PDAM:", pick(/PDAM/i).map((r) => `${r.product_name} [${r.buyer_sku_code}]`));
  console.log("BPJS:", pick(/BPJS/i).map((r) => `${r.product_name} [${r.buyer_sku_code}] admin=${r.admin}`));
  console.log("Kunci satu baris:", Object.keys(rows[0] ?? {}));
}

// 2) Cek tagihan. Dua percobaan untuk membedakan penyebab "Signature salah":
//    (a) mode uji (testing=true) — Digiflazz biasanya meminta kunci DEVELOPMENT;
//    (b) tanpa testing dengan kunci yang sama (kunci PRODUKSI). Hanya cek tagihan
//        dengan nomor uji: tidak ada pembayaran dan tidak ada saldo bergerak.
async function tryInquiry(label, testing) {
  const refId = `probe${Date.now()}${testing ? "t" : "p"}`;
  const result = await post("/transaction", {
    commands: "inq-pasca",
    username,
    buyer_sku_code: "pln",
    customer_no: "530000000001",
    ref_id: refId,
    ...(testing ? { testing: true } : {}),
    sign: md5(`${username}${apiKey}${refId}`)
  });
  const d = result.json?.data;
  console.log(`\n[${label}] HTTP ${result.status} status=${d?.status} rc=${d?.rc} message=${d?.message}`);
  if (d && d.status === "Sukses") {
    console.log("Bentuk respons sukses (kunci dan tipe):");
    console.log(JSON.stringify(shape(result.json), null, 2));
  }
}
await tryInquiry("mode uji, testing=true", true);
await tryInquiry("tanpa testing (kunci produksi)", false);
