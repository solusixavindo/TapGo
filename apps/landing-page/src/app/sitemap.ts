import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const routes = ["", "/daftar", "/privacy-policy", "/terms-and-conditions", "/refund-policy", "/contact", "/delete-account", "/hapus-akun"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `https://tapgolion.id${route}`,
    lastModified: new Date("2026-06-04"),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7
  }));
}
