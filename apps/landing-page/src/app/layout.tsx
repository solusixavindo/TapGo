import type { Metadata } from "next";
import { FloatingWhatsApp } from "./shared";
import "./globals.css";

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
    <html lang="id">
      <body>
        {children}
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
