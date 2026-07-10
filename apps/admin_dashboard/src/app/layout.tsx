import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TapGo Admin",
  description: "Enterprise operations dashboard for TapGo."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
