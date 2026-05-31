"use client";
/**
 * Sign-in page — uses Clerk's hosted <SignIn /> widget.
 *
 * Bugs fixed
 * ----------
 * Previously this page was a plain HTML form that just called setTimeout()
 * and pushed to /dashboard — it never called Clerk at all, so no real
 * authentication happened and the backend received no JWT.
 *
 * Now we render Clerk's <SignIn /> component which handles:
 *   - Email / password login
 *   - OAuth (Google, GitHub, etc — whatever you enabled in the Clerk dashboard)
 *   - Email verification codes
 *   - Password reset
 *   - Auto-redirect to /home on success (fallbackRedirectUrl)
 */
import { SignIn } from "@clerk/nextjs";
import Image from "next/image";
import { motion } from "framer-motion";
import { useTranslation } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";

export default function SignInPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      {/* Language picker — top-right so users can localise before signing in */}
      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher />
      </div>
      {/* Background orbs */}
      <motion.div
        className="absolute rounded-full bg-fin-500/10 blur-3xl pointer-events-none"
        style={{ width: 300, height: 300, top: "-10%", left: "-5%" }}
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 5, repeat: Infinity }}
      />
      <motion.div
        className="absolute rounded-full bg-fin-500/10 blur-3xl pointer-events-none"
        style={{ width: 200, height: 200, top: "60%", right: "-8%" }}
        animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 6, repeat: Infinity, delay: 1.5 }}
      />

      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-6">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center"
        >
          <Image
            src="/logo-mark.svg"
            alt="Fin-Sight"
            width={56}
            height={56}
            className="drop-shadow-[0_0_30px_rgba(245,166,35,0.5)] mb-2"
            priority
          />
          <h1 className="text-2xl font-bold tracking-tight">
            Fin<span className="text-fin-400">-</span>Sight
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("auth.tagline")}
          </p>
        </motion.div>

        {/* Clerk SignIn widget */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <SignIn
            fallbackRedirectUrl="/home"
            appearance={{
              variables: {
                colorPrimary: "#f5a623",
                colorBackground: "hsl(0 0% 11%)",
                colorInputBackground: "rgba(255,255,255,0.04)",
                colorText: "#f8fafc",
                colorTextSecondary: "#94a3b8",
                colorInputText: "#f8fafc",
                borderRadius: "0.75rem",
              },
              elements: {
                card: "shadow-2xl border border-white/[0.07]",
                headerTitle: "text-foreground font-semibold",
                headerSubtitle: "text-muted-foreground",
                formButtonPrimary:
                  "bg-fin-500 hover:bg-fin-400 text-white font-medium transition-colors",
                footerActionLink: "text-fin-400 hover:text-fin-300",
                formFieldInput:
                  "border-white/10 bg-white/[0.04] text-foreground focus:border-fin-500/40",
                dividerLine: "bg-white/[0.07]",
                dividerText: "text-muted-foreground",
                socialButtonsBlockButton:
                  "border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
              },
            }}
          />
        </motion.div>

        {/* Compliance note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center text-xs text-muted-foreground"
        >
          {t("auth.compliance")}
        </motion.p>
      </div>
    </div>
  );
}
