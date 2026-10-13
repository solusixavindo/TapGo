/**
 * Membaca kota dan provinsi dari alamat teks bebas.
 *
 * TapGo tidak menyimpan koordinat atau wilayah administratif untuk member dan pengemudi; yang ada hanya alamat yang
 * diketik (alamat domisili pendaftaran, alamat pengemudi) atau hasil geocoder (alamat titik jemput). Hasil di sini
 * PERKIRAAN: alamat yang tidak memuat nama kota yang jelas dilaporkan sebagai tidak terbaca, bukan ditebak.
 */

const PROVINCES: Array<{ name: string; aliases: string[] }> = [
  { name: "Aceh", aliases: ["aceh", "nanggroe aceh darussalam"] },
  { name: "Sumatera Utara", aliases: ["sumatera utara", "sumatra utara", "sumut"] },
  { name: "Sumatera Barat", aliases: ["sumatera barat", "sumatra barat", "sumbar"] },
  { name: "Riau", aliases: ["riau"] },
  { name: "Kepulauan Riau", aliases: ["kepulauan riau", "kepri"] },
  { name: "Jambi", aliases: ["jambi"] },
  { name: "Sumatera Selatan", aliases: ["sumatera selatan", "sumatra selatan", "sumsel"] },
  { name: "Kepulauan Bangka Belitung", aliases: ["kepulauan bangka belitung", "bangka belitung", "babel"] },
  { name: "Bengkulu", aliases: ["bengkulu"] },
  { name: "Lampung", aliases: ["lampung"] },
  { name: "DKI Jakarta", aliases: ["dki jakarta", "daerah khusus ibukota jakarta", "jakarta"] },
  { name: "Jawa Barat", aliases: ["jawa barat", "jabar"] },
  { name: "Banten", aliases: ["banten"] },
  { name: "Jawa Tengah", aliases: ["jawa tengah", "jateng"] },
  { name: "DI Yogyakarta", aliases: ["di yogyakarta", "daerah istimewa yogyakarta", "yogyakarta", "diy"] },
  { name: "Jawa Timur", aliases: ["jawa timur", "jatim"] },
  { name: "Bali", aliases: ["bali"] },
  { name: "Nusa Tenggara Barat", aliases: ["nusa tenggara barat", "ntb"] },
  { name: "Nusa Tenggara Timur", aliases: ["nusa tenggara timur", "ntt"] },
  { name: "Kalimantan Barat", aliases: ["kalimantan barat", "kalbar"] },
  { name: "Kalimantan Tengah", aliases: ["kalimantan tengah", "kalteng"] },
  { name: "Kalimantan Selatan", aliases: ["kalimantan selatan", "kalsel"] },
  { name: "Kalimantan Timur", aliases: ["kalimantan timur", "kaltim"] },
  { name: "Kalimantan Utara", aliases: ["kalimantan utara", "kaltara"] },
  { name: "Sulawesi Utara", aliases: ["sulawesi utara", "sulut"] },
  { name: "Gorontalo", aliases: ["gorontalo"] },
  { name: "Sulawesi Tengah", aliases: ["sulawesi tengah", "sulteng"] },
  { name: "Sulawesi Barat", aliases: ["sulawesi barat", "sulbar"] },
  { name: "Sulawesi Selatan", aliases: ["sulawesi selatan", "sulsel"] },
  { name: "Sulawesi Tenggara", aliases: ["sulawesi tenggara", "sultra"] },
  { name: "Maluku", aliases: ["maluku"] },
  { name: "Maluku Utara", aliases: ["maluku utara"] },
  { name: "Papua", aliases: ["papua"] },
  { name: "Papua Barat", aliases: ["papua barat"] },
  { name: "Papua Barat Daya", aliases: ["papua barat daya"] },
  { name: "Papua Selatan", aliases: ["papua selatan"] },
  { name: "Papua Tengah", aliases: ["papua tengah"] },
  { name: "Papua Pegunungan", aliases: ["papua pegunungan"] }
];

/** Alias terpanjang lebih dulu: "papua barat daya" harus menang atas "papua barat" dan "papua". */
const PROVINCE_MATCHERS = PROVINCES.flatMap((province) => province.aliases.map((alias) => ({ province: province.name, alias })))
  .sort((left, right) => right.alias.length - left.alias.length)
  .map((entry) => ({ province: entry.province, pattern: new RegExp(`(^|[^a-z])${entry.alias.replace(/\s+/g, "\\s+")}($|[^a-z])`) }));

const STREET_PREFIXES = /^(jl|jln|jalan|gg|gang|kec|kecamatan|kel|kelurahan|desa|dusun|rt|rw|no|blok|komplek|kompleks|perumahan|perum|ruko|lt|lantai)\b/i;
const NAME_SHAPE = /^[A-Za-z][A-Za-z .'-]{2,29}$/;

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function provinceOf(address: string): string | null {
  const text = address.toLowerCase();
  for (const matcher of PROVINCE_MATCHERS) {
    if (matcher.pattern.test(text)) return matcher.province;
  }
  return null;
}

/**
 * Kunci pengelompokan kota: "Kota Surabaya" dan "Surabaya" digabung; kabupaten dibedakan ("Kab. Bogor" bukan "Bogor").
 * `label` adalah teks yang ditampilkan.
 */
export function cityOf(address: string): { key: string; label: string } | null {
  const prefixed = /\b(Kota|Kabupaten|Kab\.?)\s+([A-Za-z][A-Za-z .'-]{1,30}?)(?=\s*(?:,|$|\d))/i.exec(address);
  if (prefixed) {
    const name = titleCase(prefixed[2]!.trim());
    const kabupaten = /^kab/i.test(prefixed[1]!);
    if (name.length >= 3) {
      return kabupaten ? { key: `kab:${name.toLowerCase()}`, label: `Kab. ${name}` } : { key: name.toLowerCase(), label: name };
    }
  }

  const segments = address
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  // Satu segmen tanpa koma ("Dekat pasar") tidak punya struktur untuk dibaca; menganggapnya kota berarti menebak.
  if (segments.length < 2) return null;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    if (/^indonesia$/i.test(segment) || /\d{5}/.test(segment) || provinceOf(segment) !== null) continue;
    if (STREET_PREFIXES.test(segment) || !NAME_SHAPE.test(segment)) continue;
    const name = titleCase(segment);
    return { key: name.toLowerCase(), label: name };
  }
  return null;
}

export type RegionCount = { name: string; count: number };

/** Hitung kemunculan kota dan provinsi dari kumpulan alamat; `unreadable` = alamat yang kotanya tidak terbaca. */
export function tallyRegions(addresses: Array<string | null | undefined>, limit = 8) {
  const cities = new Map<string, { label: string; count: number }>();
  const provinces = new Map<string, number>();
  let total = 0;
  let unreadable = 0;
  for (const raw of addresses) {
    const address = raw?.trim();
    if (!address) continue;
    total += 1;
    const city = cityOf(address);
    if (city) {
      const existing = cities.get(city.key);
      if (existing) existing.count += 1;
      else cities.set(city.key, { label: city.label, count: 1 });
    } else {
      unreadable += 1;
    }
    const province = provinceOf(address);
    if (province) provinces.set(province, (provinces.get(province) ?? 0) + 1);
  }
  const top = (entries: RegionCount[]) =>
    entries.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "id")).slice(0, limit);
  return {
    total,
    unreadable,
    cities: top([...cities.values()].map((entry) => ({ name: entry.label, count: entry.count }))),
    provinces: top([...provinces.entries()].map(([name, count]) => ({ name, count })))
  };
}
