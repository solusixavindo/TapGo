import type { Metadata } from "next";
import "./globals.css";
import ConsoleShell from "./console-shell";
import { THEME_BOOT_SCRIPT } from "../lib/theme";

export const metadata: Metadata = {
  title: "TapGo Admin",
  description: "Enterprise operations dashboard for TapGo."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <ConsoleShell>{children}</ConsoleShell>
      </body>
    </html>
  );
}
