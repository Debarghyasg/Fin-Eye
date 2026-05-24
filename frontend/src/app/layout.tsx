import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FinSight AI — Financial Document Intelligence",
  description:
    "Production-grade AI platform for querying, comparing, and monitoring financial documents — 10-Ks, earnings calls, SEC filings.",
  keywords: ["financial AI", "RAG", "document intelligence", "SEC filings", "earnings analysis"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}
