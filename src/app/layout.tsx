import type { Metadata } from "next";
import { Figtree, Syne } from "next/font/google";

import "./globals.css";

const bodyFont = Figtree({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Per Diem Menu",
    template: "%s | Per Diem Menu",
  },
  description: "Browse a Square-powered menu across multiple locations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans text-ink">
        <a className="skip-link" href="#main-content">
          Skip to menu
        </a>
        {children}
      </body>
    </html>
  );
}
