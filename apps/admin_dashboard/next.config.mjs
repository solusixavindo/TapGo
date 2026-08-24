/** @type {import('next').NextConfig} */

/*
 * Konsol admin disajikan sebagai berkas statis di bawah /admin pada domain yang
 * sama dengan API (api.tapgolion.id/admin/).
 *
 * Ditaruh satu domain dengan API bukan sekadar demi kepraktisan: dengan begitu
 * permintaan konsol menjadi same-origin, sehingga tidak ada CORS yang perlu
 * dikonfigurasi, tidak ada sertifikat SSL tambahan, dan tidak ada catatan DNS
 * baru. Tiga titik gagal sekaligus hilang.
 *
 * Nilai NEXT_PUBLIC_TAPGO_API_BASE_URL saat build WAJIB relatif ("/api/v1").
 * Bawaannya di src/lib/api.ts adalah http://127.0.0.1:4000/api/v1, yang di
 * peramban admin berarti localhost milik admin sendiri — dan karena halamannya
 * https, permintaan http itu akan diblokir sebagai konten campuran.
 *
 * basePath dapat diganti lewat env TAPGO_ADMIN_BASE_PATH (mis.
 * "/konsol-abc123") agar URL konsol tidak mudah ditebak (obscurity). Path acak
 * bukan pengganti autentikasi — ia pelengkap basic-auth Nginx dan penjaga role
 * di backend. Karena konsol di-export statis, mengganti basePath WAJIB
 * diikuti build ulang: seluruh URL aset terpanggang saat build.
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "export",
  basePath: process.env.TAPGO_ADMIN_BASE_PATH ?? "/admin",
  trailingSlash: true,
  images: {
    unoptimized: true
  }
};

export default nextConfig;
