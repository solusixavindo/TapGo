import { describe, expect, it } from "vitest";
import { cityOf, provinceOf, tallyRegions } from "../../src/core/geo/indonesiaRegions.js";

describe("pembacaan wilayah dari alamat", () => {
  it("membaca kota berawalan Kota/Kabupaten dari alamat gaya geocoder", () => {
    expect(cityOf("Jl. Basuki Rahmat No. 12, Kec. Genteng, Kota Surabaya, Jawa Timur 60271, Indonesia")).toEqual({ key: "surabaya", label: "Surabaya" });
    expect(cityOf("Jalan Raya Puncak, Kec. Cisarua, Kabupaten Bogor, Jawa Barat 16750")).toEqual({ key: "kab:bogor", label: "Kab. Bogor" });
    expect(cityOf("Jl. Merdeka, Kab. Malang, Jawa Timur")).toEqual({ key: "kab:malang", label: "Kab. Malang" });
  });

  it("menggabungkan 'Kota Surabaya' dengan 'Surabaya' tetapi tidak menggabungkan kota dan kabupaten bernama sama", () => {
    const tally = tallyRegions([
      "Jl. A, Kota Surabaya, Jawa Timur",
      "Jalan Mawar 5, Kel. Sukolilo, Kec. Sukolilo, Surabaya",
      "Jl. B, Kota Bogor, Jawa Barat",
      "Jl. C, Kabupaten Bogor, Jawa Barat"
    ]);
    expect(tally.cities).toEqual([
      { name: "Surabaya", count: 2 },
      { name: "Bogor", count: 1 },
      { name: "Kab. Bogor", count: 1 }
    ]);
  });

  it("alamat bebas: mengambil segmen terakhir yang berupa nama, melewati jalan, kode pos, provinsi, dan Indonesia", () => {
    expect(cityOf("Jalan Melati No 3, RT 02 RW 05, Malang, Jawa Timur 65145, Indonesia")?.label).toBe("Malang");
    expect(cityOf("jl. kenanga blok c, kel. x, kec. y, denpasar")?.label).toBe("Denpasar");
  });

  it("tidak menebak: alamat tanpa nama kota yang jelas dihitung tidak terbaca", () => {
    expect(cityOf("Jl. Kenanga No 7")).toBeNull();
    expect(cityOf("Dekat pasar")).toBeNull();
    expect(cityOf("Surabaya")).toBeNull();
    expect(cityOf("Rumah dekat pasar 123")).toBeNull();
    expect(cityOf("")).toBeNull();
    const tally = tallyRegions(["Jl. Kenanga No 7", "Jl. A, Kota Surabaya", null, "   "]);
    expect(tally).toMatchObject({ total: 2, unreadable: 1 });
  });

  it("membaca provinsi, alias umum, dan alias terpanjang lebih dulu", () => {
    expect(provinceOf("Jl. X, Kota Surabaya, Jawa Timur 60271")).toBe("Jawa Timur");
    expect(provinceOf("Jl. X, Jakarta Selatan")).toBe("DKI Jakarta");
    expect(provinceOf("Jl. X, Sleman, Yogyakarta")).toBe("DI Yogyakarta");
    expect(provinceOf("Kota Sorong, Papua Barat Daya")).toBe("Papua Barat Daya");
    expect(provinceOf("Manokwari, Papua Barat")).toBe("Papua Barat");
    expect(provinceOf("Jayapura, Papua")).toBe("Papua");
    expect(provinceOf("Mataram, NTB")).toBe("Nusa Tenggara Barat");
    expect(provinceOf("Jl. Tanpa Provinsi")).toBeNull();
  });

  it("tidak salah menangkap potongan kata sebagai provinsi", () => {
    // "riau" ada di dalam "kepulauan riau" tetapi bukan di dalam kata lain; "bali" bukan bagian dari "Balikpapan".
    expect(provinceOf("Jl. X, Balikpapan, Kalimantan Timur")).toBe("Kalimantan Timur");
    expect(provinceOf("Jl. X, Balikpapan")).toBeNull();
  });

  it("urutan teratas diurutkan menurun lalu menurut abjad, dan dibatasi", () => {
    const addresses = ["Kota Medan", "Kota Bandung", "Kota Bandung", "Kota Padang", "Kota Padang", "Kota Solo"];
    const tally = tallyRegions(addresses, 3);
    expect(tally.cities.map((city) => city.name)).toEqual(["Bandung", "Padang", "Medan"]);
  });
});
