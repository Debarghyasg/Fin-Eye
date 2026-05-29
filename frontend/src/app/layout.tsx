import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";
export const metadata: Metadata = {
  title: "Fin-Sight",
  description: "Financial Document Intelligence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      {/* `lang` is updated client-side by the i18n provider on language switch. */}
      <html lang="en">
        <body>
          <I18nProvider>{children}</I18nProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}