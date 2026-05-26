import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
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

/**
 * Root layout. We mount `<ClerkProvider>` here (not in the (app) group
 * layout) so Clerk's React context is available on every route — including
 * the public `/sign-in` and `/sign-up` pages that render `<SignIn />` /
 * `<SignUp />` widgets. `useAuth().getToken()` returns a real JWT only
 * when this provider is mounted AND the matching middleware in
 * `src/middleware.ts` runs; without both, document uploads silently send
 * no Authorization header and the backend rejects them with 401.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={inter.variable}>
        <body className={`${inter.className} antialiased`}>{children}</body>
      </html>
    </ClerkProvider>
  );
}
