import type { Metadata } from "next";
import { FloatingWhatsApp } from "./shared";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import "./globals.css";

/**
 * Dijalankan sinkron sebelum render pertama (lihat <head> di bawah), supaya:
 * 1. Tema terang/gelap yang tersimpan langsung berlaku, tidak ada kedipan
 *    warna gelap→terang sesaat setelah halaman termuat.
 * 2. class "js" hanya ditambahkan bila skrip ini sungguh berjalan — animasi
 *    scroll-reveal di globals.css (html.js .reveal-init) karena itu tidak
 *    pernah membuat konten hilang permanen kalau JavaScript gagal dimuat.
 */
const themeInitScript = `
(function () {
  try {
    var stored = window.localStorage.getItem("tapgo.theme");
    var theme = stored === "light" || stored === "dark" ? stored : "dark";
    document.documentElement.dataset.theme = theme;
  } catch (e) {}
  document.documentElement.classList.add("js");
})();
`;

export const metadata: Metadata = {
  metadataBase: new URL("https://tapgolion.id"),
  title: {
    default: "TapGo Lion Indonesia | Platform Membership Digital",
    template: "%s | TapGo Lion"
  },
  description:
    "TapGo Lion Indonesia adalah platform membership digital yang menghadirkan berbagai manfaat, layanan digital, peluang usaha, dan komunitas yang berkembang bersama melalui teknologi modern.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/images/tapgo-logo.png"
  },
  openGraph: {
    title: "TapGo Lion Indonesia | Platform Membership Digital",
    description:
      "TapGo Lion Indonesia adalah platform membership digital yang menghadirkan berbagai manfaat, layanan digital, peluang usaha, dan komunitas yang berkembang bersama melalui teknologi modern.",
    url: "https://tapgolion.id",
    siteName: "TapGo Lion",
    locale: "id_ID",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "TapGo Lion Indonesia | Platform Membership Digital",
    description:
      "Platform membership digital untuk manfaat, layanan digital, peluang usaha, dan komunitas berbasis teknologi modern."
  },
  alternates: {
    canonical: "/"
  }
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "PT. TapGo Lion Indonesia",
  url: "https://tapgolion.id",
  email: "support@tapgolion.id",
  telephone: "+6283800255588",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Jalan Kp. Pasir Gendok No. 11, Desa Bojongleles",
    addressLocality: "Rangkasbitung",
    addressRegion: "Banten",
    addressCountry: "ID"
  }
};

const localBusinessSchema = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "PT. TapGo Lion Indonesia",
  url: "https://tapgolion.id",
  email: "support@tapgolion.id",
  telephone: "+6283800255588",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Jalan Kp. Pasir Gendok No. 11, Desa Bojongleles",
    addressLocality: "Rangkasbitung",
    addressRegion: "Banten",
    addressCountry: "ID"
  },
  areaServed: "Indonesia"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className="no-js">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <SiteHeader />
        <div className="page-body">{children}</div>
        <SiteFooter />
        <FloatingWhatsApp />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
        />
      </body>
    </html>
  );
}
