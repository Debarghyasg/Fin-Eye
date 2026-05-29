"use client";
/**
 * Sign-up page — uses Clerk's hosted <SignUp /> widget.
 *
 * Bugs fixed
 * ----------
 * Previously this was a custom multi-step HTML form that never called Clerk.
 * The "Create workspace" button just ran setTimeout() and redirected to
 * /dashboard — no account was ever created, no JWT was issued.
 *
 * Now we render Clerk's <SignUp /> component which handles:
 *   - Email + password registration
 *   - Email verification code
 *   - OAuth sign-up (Google, GitHub, etc.)
 *   - Auto-redirect to /dashboard on success (afterSignUpUrl)
 *
 * On first sign-in after registration, the backend's get_current_user
 * dependency auto-creates:
 *   1. A User row (linked to the Clerk user_id)
 *   2. A default Workspace  ← see dependencies.py fix
 */
import { SignUp } from "@clerk/nextjs";
import Image from "next/image";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";

const FEATURE_KEYS = [
  "auth.feature1",
  "auth.feature2",
  "auth.feature3",
  "auth.feature4",
  "auth.feature5",
];

export default function SignUpPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* Language picker — top-right so users can localise before signing up */}
      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher />
      </div>
      {/* Left panel — branding */}
      <motion.div
        initial={{ opacity: 0, x: -30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 border-r border-white/[0.07] relative overflow-hidden"
      >
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "50px 50px",
          }}
        />
        <div className="absolute top-0 left-0 w-96 h-96 bg-fin-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <Image
            src="/logo-mark.svg"
            alt="Fin-Sight"
            width={44}
            height={44}
            className="drop-shadow-[0_0_15px_rgba(34,162,105,0.4)]"
            priority
          />
          <span className="text-xl font-bold tracking-tight">
            Fin<span className="text-fin-400">-</span>Sight
          </span>
        </div>

        <div className="relative z-10">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-bold mb-3 leading-tight"
          >
            {t("auth.institutionalGrade")}
            <br />
            <span className="text-gradient">{t("auth.forAnalysts")}</span>
          </motion.h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            {t("auth.queryDesc")}
          </p>

          <div className="space-y-3">
            {FEATURE_KEYS.map((f, i) => (
              <motion.div
                key={f}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="flex items-center gap-3"
              >
                <div className="w-5 h-5 rounded-full bg-fin-500/20 border border-fin-500/40 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-fin-400" />
                </div>
                <span className="text-sm text-muted-foreground">{t(f)}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-fin-500/10 border border-fin-500/20">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-fin-400 to-fin-600 flex items-center justify-center text-sm font-bold text-white">
              JP
            </div>
            <div>
              <p className="text-sm font-medium">
                {t("auth.testimonial")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("auth.testimonialAuthor")}
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Right panel — Clerk SignUp widget */}
      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center gap-6"
        >
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2">
            <Image src="/logo-mark.svg" alt="Fin-Sight" width={36} height={36} priority />
            <span className="text-lg font-bold">
              Fin<span className="text-fin-400">-</span>Sight
            </span>
          </div>

          <SignUp
            fallbackRedirectUrl="/dashboard"
            appearance={{
              variables: {
                colorPrimary: "#22a269",
                colorBackground: "hsl(222 47% 7%)",
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
      </div>
    </div>
  );
}
