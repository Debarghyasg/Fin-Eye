import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fin-Sight — Financial Document Intelligence",
  description:
    "AI-powered platform for querying, comparing, and monitoring financial documents — 10-Ks, earnings calls, SEC filings — with cited answers and full audit trails.",
  keywords: [
    "financial AI",
    "RAG",
    "document intelligence",
    "SEC filings",
    "earnings analysis",
    "Fin-Sight",
  ],
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}
