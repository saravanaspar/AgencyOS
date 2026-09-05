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
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
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
