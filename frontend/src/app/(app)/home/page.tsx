"use client";
/**
 * Home / overview page.
 *
 * This is the first page a user lands on after signing in. It explains what
 * Fin-Sight is, the problem it solves, the four user-facing capabilities,
 * how the pipeline works, and offers quick links into the rest of the app.
 *
 * Layout notes (kept deliberately overlap-free):
 *   - The page owns its own vertical scroll (`flex-1 overflow-y-auto`) under a
 *     sticky <Header />, mirroring every other (app) page.
 *   - Sections are separated with a single `space-y-*` rhythm; cards use grid
 *     `gap-*` only — no negative margins or absolute positioning (apart from a
 *     `pointer-events-none` decorative glow) — so nothing can stack on top of
 *     anything else at any breakpoint.
 */
import React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  MessageSquare,
  GitCompare,
  Activity,
  Bell,
  Upload,
  Scissors,
  Database,
  Search,
  CheckCircle2,
  Shield,
  Lock,
  ArrowRight,
  FileText,
  BarChart3,
  Sparkles,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

export default function HomePage() {
  const { t } = useTranslation();

  const capabilities = [
    { icon: MessageSquare, titleKey: "home.cap1Title", descKey: "home.cap1Desc", color: "text-fin-400", bg: "bg-fin-500/10" },
    { icon: GitCompare, titleKey: "home.cap2Title", descKey: "home.cap2Desc", color: "text-blue-400", bg: "bg-blue-500/10" },
    { icon: Activity, titleKey: "home.cap3Title", descKey: "home.cap3Desc", color: "text-amber-400", bg: "bg-amber-500/10" },
    { icon: Bell, titleKey: "home.cap4Title", descKey: "home.cap4Desc", color: "text-violet-400", bg: "bg-violet-500/10" },
  ];

  const steps = [
    { icon: Upload, titleKey: "home.step1Title", descKey: "home.step1Desc" },
    { icon: Scissors, titleKey: "home.step2Title", descKey: "home.step2Desc" },
    { icon: Database, titleKey: "home.step3Title", descKey: "home.step3Desc" },
    { icon: Search, titleKey: "home.step4Title", descKey: "home.step4Desc" },
    { icon: Sparkles, titleKey: "home.step5Title", descKey: "home.step5Desc" },
  ];

  const trust = [
    { icon: CheckCircle2, titleKey: "home.why1Title", descKey: "home.why1Desc", color: "text-fin-400", bg: "bg-fin-500/10" },
    { icon: Shield, titleKey: "home.why2Title", descKey: "home.why2Desc", color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { icon: Lock, titleKey: "home.why3Title", descKey: "home.why3Desc", color: "text-blue-400", bg: "bg-blue-500/10" },
  ];

  const quickLinks = [
    { href: "/workspace", icon: FileText, labelKey: "nav.workspace", descKey: "home.linkWorkspaceDesc" },
    { href: "/compare", icon: GitCompare, labelKey: "nav.compare", descKey: "home.linkCompareDesc" },
    { href: "/analytics", icon: BarChart3, labelKey: "nav.analytics", descKey: "home.linkAnalyticsDesc" },
    { href: "/alerts", icon: Bell, labelKey: "nav.alerts", descKey: "home.linkAlertsDesc" },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header title={t("home.title")} subtitle={t("home.subtitle")} />

      <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-8">
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative overflow-hidden gradient-card p-6 sm:p-8 lg:p-10"
        >
          {/* Decorative glow — pointer-events-none so it never blocks clicks */}
          <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-fin-500/10 blur-3xl pointer-events-none" />

          <div className="relative z-10 max-w-3xl">
            <Badge variant="default" className="mb-4 gap-1.5">
              <Sparkles className="w-3 h-3" />
              {t("home.heroBadge")}
            </Badge>

            <div className="flex items-center gap-3 mb-4">
              <Image
                src="/logo-mark.svg"
                alt="Fin-Sight"
                width={40}
                height={40}
                className="drop-shadow-[0_0_18px_rgba(245,166,35,0.45)] flex-shrink-0"
                priority
              />
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
                Fin<span className="text-fin-400">-</span>Sight
              </h2>
            </div>

            <h1 className="text-xl sm:text-2xl font-semibold leading-snug mb-3">
              <span className="text-gradient">{t("home.heroTitle")}</span>
            </h1>

            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed mb-6">
              {t("home.heroLead")}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button asChild variant="glow" size="lg" className="gap-2">
                <Link href="/workspace">
                  <Upload className="w-4 h-4" />
                  {t("home.ctaWorkspace")}
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="gap-2">
                <Link href="/dashboard">
                  <BarChart3 className="w-4 h-4" />
                  {t("home.ctaDashboard")}
                </Link>
              </Button>
            </div>
          </div>
        </motion.section>

        {/* ── Problem ───────────────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.06 }}
          className="gradient-card p-6 sm:p-8"
        >
          <h2 className="text-base font-semibold mb-2 flex items-center gap-2">
            <span className="w-1.5 h-5 rounded-full bg-fin-500 flex-shrink-0" />
            {t("home.problemTitle")}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-4xl">
            {t("home.problemBody")}
          </p>
        </motion.section>

        {/* ── Capabilities ──────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">{t("home.capabilitiesTitle")}</h2>
            <p className="text-xs text-muted-foreground mt-1">{t("home.capabilitiesLead")}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {capabilities.map((cap, i) => {
              const Icon = cap.icon;
              return (
                <motion.div
                  key={cap.titleKey}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="gradient-card p-5 flex items-start gap-4 h-full"
                >
                  <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0", cap.bg)}>
                    <Icon className={cn("w-5 h-5", cap.color)} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold mb-1">{t(cap.titleKey)}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{t(cap.descKey)}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">{t("home.howTitle")}</h2>
            <p className="text-xs text-muted-foreground mt-1">{t("home.howLead")}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={step.titleKey}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="gradient-card p-5 flex flex-col gap-3 h-full"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-lg bg-fin-500/10 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-fin-400" />
                    </div>
                    <span className="text-xs font-mono font-semibold text-muted-foreground/60">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">{t(step.titleKey)}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{t(step.descKey)}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* ── Why / trust ───────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold">{t("home.whyTitle")}</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {trust.map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.titleKey}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="gradient-card p-5 h-full"
                >
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center mb-3", item.bg)}>
                    <Icon className={cn("w-5 h-5", item.color)} />
                  </div>
                  <h3 className="text-sm font-semibold mb-1">{t(item.titleKey)}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t(item.descKey)}</p>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* ── Quick links ───────────────────────────────────────────────── */}
        <section className="space-y-4 pb-2">
          <div>
            <h2 className="text-base font-semibold">{t("home.quickLinksTitle")}</h2>
            <p className="text-xs text-muted-foreground mt-1">{t("home.quickLinksLead")}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickLinks.map((link, i) => {
              const Icon = link.icon;
              return (
                <motion.div
                  key={link.href}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                >
                  <Link
                    href={link.href}
                    className="group gradient-card p-5 flex items-center gap-4 h-full transition-colors hover:border-fin-500/30"
                  >
                    <div className="w-10 h-10 rounded-lg bg-fin-500/10 flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105">
                      <Icon className="w-4 h-4 text-fin-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{t(link.labelKey)}</p>
                      <p className="text-xs text-muted-foreground truncate">{t(link.descKey)}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 transition-all group-hover:text-fin-400 group-hover:translate-x-0.5" />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
