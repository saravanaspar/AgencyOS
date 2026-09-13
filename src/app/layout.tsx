import "@fontsource-variable/inter";
import "./globals.css";
import "./documents.css";
import "./reports-executive.css";

import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "AgencyOS",
    template: "%s | AgencyOS",
  },
  description: "A unified operating system for agency work.",
  icons: {
    icon: [{ url: "/agencyos-mark-transparent.png", type: "image/png" }],
    shortcut: "/agencyos-mark-transparent.png",
    apple: "/agencyos-mark-transparent.png",
  },
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
