#!/usr/bin/env node
/**
 * Penjaga tema gelap konsol admin.
 *
 * Halaman ditulis dengan kelas Tailwind terang dan dipetakan ulang di globals.css hanya saat tema gelap.
 * Kelas yang tidak terpetakan tampil sebagai kotak abu-abu terang bertulisan pucat (temuan Owner 15 Nov 2026:
 * `bg-white/70` di Dokumen Driver). Skrip ini gagal bila ada kelas LATAR TERANG atau TEKS GELAP yang dipakai
 * halaman tetapi belum punya aturan di blok tema gelap.
 *
 *   node scripts/check-dark-theme.mjs
 *
 * Tidak memeriksa kelas pekat (bg-emerald-700 + text-white, bg-rose-600, ...) karena tetap terbaca di latar gelap.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const css = readFileSync(join(srcDir, "app", "globals.css"), "utf8");

// Selektor yang diawali :root:not([data-theme="light"]) -> himpunan kelas (tanpa escape).
const mapped = new Set();
for (const block of css.matchAll(/:root:not\(\[data-theme="light"\]\)([^{]+)\{/g)) {
  for (const cls of block[1].matchAll(/\.((?:[a-z-]+\\:)*[A-Za-z0-9\\./[\]-]+)/g)) {
    mapped.add(cls[1].replace(/\\/g, ""));
  }
}

const COLORS = "slate|gray|zinc|neutral|stone|red|rose|amber|emerald|green|blue|sky|indigo|violet|purple|orange|yellow|teal|cyan|pink|fuchsia|lime";
const PREFIX = "(?:hover:|focus:|disabled:|group-hover:)?";
// Latar terang: putih/putih tembus pandang dan nuansa 50-200; teks gelap: nuansa 600-950.
const rules = [
  new RegExp(`(?<![\\w-])(${PREFIX}bg-white/[0-9]{1,3})(?![\\w-])`, "g"),
  new RegExp(`(?<![\\w-])(${PREFIX}bg-(?:${COLORS})-(?:50|100|200)(?:/[0-9]{1,3})?)(?![\\w-])`, "g"),
  new RegExp(`(?<![\\w-])(${PREFIX}text-(?:${COLORS})-(?:700|800|900|950)(?:/[0-9]{1,3})?)(?![\\w-])`, "g"),
  new RegExp(`(?<![\\w-])(${PREFIX}border-(?:${COLORS})-(?:100|200|300)(?:/[0-9]{1,3})?)(?![\\w-])`, "g")
];

// Panel yang sejak awal dirancang gelap (konsol-shell, visual beranda) sengaja memakai bg-white/10 dan sejenisnya.
const DARK_NATIVE_FILES = [/console-shell\.tsx$/, /period-filter\.tsx$/, /beranda[\\/]visuals\.tsx$/];

// Pengecualian eksplisit (kelas + berkas + alasan). Tambah di sini hanya bila elemennya berada di panel gelap.
const ALLOWED = [
  { cls: "bg-white/10", file: /beranda[\\/]vip-insights\.tsx$/, why: "lintasan progres di dalam hero gradasi navy" }
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

const missing = new Map();
for (const file of walk(srcDir)) {
  const rel = relative(root, file);
  if (DARK_NATIVE_FILES.some((re) => re.test(file))) continue;
  const text = readFileSync(file, "utf8");
  for (const re of rules) {
    for (const m of text.matchAll(re)) {
      const cls = m[1];
      if (cls.startsWith("print:") || mapped.has(cls)) continue;
      if (ALLOWED.some((a) => a.cls === cls && a.file.test(file))) continue;
      if (!missing.has(cls)) missing.set(cls, new Set());
      missing.get(cls).add(rel);
    }
  }
}

if (missing.size > 0) {
  console.error(`Tema gelap: ${missing.size} kelas terang belum terpetakan di src/app/globals.css:\n`);
  for (const [cls, files] of [...missing].sort()) {
    console.error(`  ${cls.padEnd(34)} ${[...files].slice(0, 2).join(", ")}`);
  }
  console.error("\nTambahkan aturan `:root:not([data-theme=\"light\"]) .<kelas>` di blok pemetaan tema gelap.");
  process.exit(1);
}
console.log(`Tema gelap: semua kelas terang terpetakan (${mapped.size} aturan).`);
