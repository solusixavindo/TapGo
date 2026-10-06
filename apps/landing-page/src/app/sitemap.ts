import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// Rute berakhiran "/" (situs memakai trailingSlash; tanpa garis miring Hostinger
// mengalihkan 301). /mitra tidak dimasukkan: halamannya noindex. /hapus-akun
// adalah salinan /delete-account (canonical menunjuk ke sana), jadi tidak dimuat.
const routes = ["/", "/daftar/", "/privacy-policy/", "/terms-and-conditions/", "/refund-policy/", "/contact/", "/delete-account/"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `https://tapgolion.id${route}`,
    lastModified: new Date(),
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : 0.7
  }));
}
