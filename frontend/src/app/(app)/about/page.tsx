"use client";
/**
 * About Fin-Sight — a dedicated, animation-rich info page.
 *
 * Purely informational: it describes the project, who it is for, the
 * technology behind it, headline numbers, and the creator. No data
 * fetching or app state is touched here.
 *
 * Motion design:
 *   - Each section reveals on scroll via `whileInView` (runs once).
 *   - Cards stagger in and lift on hover (`whileHover`).
 *   - Headline metrics count up when they enter the viewport (<Counter />).
 *
 * Layout is overlap-safe: a single `space-y-*` rhythm, grid `gap-*` only,
 * and the only absolutely-positioned element is a `pointer-events-none`
 * decorative glow.
 */
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useInView, type Variants } from "framer-motion";
import {
  ArrowUpRight,
  MessageSquare,
  GitCompare,
  Activity,
  Bell,
  Users,
  Shield,
  Server,
  Sparkles,
  Code,
  Database,
  Cpu,
  FileText,
  Lock,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

/* ── Inline GitHub mark (lucide deprecated its brand icons, so we ship our
      own SVG to stay version-proof) ─────────────────────────────────────── */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.16-.02-2.1-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

/* ── Shared scroll-reveal section wrapper ──────────────────────────────── */
function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ── Stagger container + item for card grids ───────────────────────────── */
const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" } },
};

/* ── Count-up number, triggered when scrolled into view ────────────────── */
function Counter({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1.4,
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / (duration * 1000), 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setValue(to * eased);
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}

export default function AboutPage() {
  const { t } = useTranslation();

  const capabilities = [
    { icon: MessageSquare, title: "Cited Q&A", desc: "Ask a filing in plain English; every answer cites the exact page and excerpt.", color: "text-fin-400", bg: "bg-fin-500/10" },
    { icon: GitCompare, title: "Document Comparison", desc: "Diff two filings: metric deltas, risk-factor changes, and an AI summary.", color: "text-blue-400", bg: "bg-blue-500/10" },
    { icon: Activity, title: "Anomaly Alerts", desc: "Per-ticker metric time series; values beyond 2σ raise a graded alert.", color: "text-amber-400", bg: "bg-amber-500/10" },
    { icon: Bell, title: "SEC Filing Watch", desc: "A poller checks EDGAR against your watchlist and notifies you in-app + email.", color: "text-violet-400", bg: "bg-violet-500/10" },
  ];

  const audiences = [
    { icon: Users, title: "Equity & research analysts", desc: "Turn 200–400 page filings into cited answers and reclaim roughly four hours a week per coverage cycle." },
    { icon: Shield, title: "Compliance & audit teams", desc: "An immutable, append-only audit trail designed to map to SEC Rule 17a-4's 7-year retention requirement." },
    { icon: Server, title: "Self-hosting builders", desc: "Run the whole platform on a vanilla laptop — no Docker, no paid SaaS, $0/month in development." },
  ];

  const stats: {
    value: number;
    decimals?: number;
    prefix?: string;
    suffix?: string;
    label: string;
  }[] = [
    { value: 400, suffix: "+", label: "Pages in a typical 10-K it digests" },
    { value: 660, suffix: " ms", label: "Median end-to-end query latency" },
    { value: 6.6, decimals: 1, suffix: "×", label: "Cheaper than the equivalent paid stack" },
    { value: 70, suffix: "%+", label: "Backend test coverage (line + branch)" },
    { value: 0, prefix: "$", label: "Monthly infra cost in development" },
    { value: 384, label: "Dimensions per local MiniLM embedding" },
  ];

  const stack = [
    { icon: Code, label: "Next.js 15", tint: "text-foreground" },
    { icon: Server, label: "FastAPI", tint: "text-emerald-400" },
    { icon: Database, label: "PostgreSQL 16", tint: "text-blue-400" },
    { icon: Cpu, label: "MiniLM (local CPU)", tint: "text-fin-400" },
    { icon: Sparkles, label: "Groq · Llama 3.1 70B", tint: "text-orange-400" },
    { icon: FileText, label: "PyMuPDF · pdfplumber", tint: "text-violet-400" },
    { icon: Shield, label: "Clerk auth", tint: "text-sky-400" },
    { icon: Lock, label: "Presidio PII scan", tint: "text-rose-400" },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header title={t("about.title")} subtitle={t("about.subtitle")} />

      <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-10">
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative overflow-hidden gradient-card p-6 sm:p-8 lg:p-10"
        >
          <motion.div
            aria-hidden
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="absolute -top-28 -right-20 w-80 h-80 rounded-full bg-fin-500/10 blur-3xl pointer-events-none"
          />

          <div className="relative z-10 max-w-3xl">
            <Badge variant="default" className="mb-4 gap-1.5">
              <Sparkles className="w-3 h-3" />
              Financial Document Intelligence
            </Badge>

            <motion.div
              className="flex items-center gap-3 mb-4"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
            >
              <Image
                src="/logo-mark.svg"
                alt="Fin-Sight"
                width={44}
                height={44}
                className="drop-shadow-[0_0_18px_rgba(245,166,35,0.45)] flex-shrink-0"
                priority
              />
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Fin<span className="text-fin-400">-</span>Sight
              </h2>
            </motion.div>

            <h1 className="text-xl sm:text-2xl font-semibold leading-snug mb-3">
              <span className="text-gradient">
                A production-grade financial RAG platform on a $0/month stack
              </span>
            </h1>

            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              Fin-Sight is a multi-tenant Retrieval-Augmented Generation platform for
              SEC filings. Upload a 10-K, 10-Q, or earnings document, ask a question in
              plain English, and get an answer that points back to the exact page and
              paragraph it came from — with document comparison, anomaly alerts, and
              proactive EDGAR monitoring built in.
            </p>
          </div>
        </motion.section>

        {/* ── By the numbers ────────────────────────────────────────────── */}
        <Reveal className="space-y-4">
          <h2 className="text-base font-semibold">By the numbers</h2>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="grid grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {stats.map((s) => (
              <motion.div
                key={s.label}
                variants={itemVariants}
                whileHover={{ y: -4 }}
                className="gradient-card p-5 h-full"
              >
                <p className="text-2xl sm:text-3xl font-bold text-gradient tabular-nums">
                  <Counter to={s.value} decimals={s.decimals} prefix={s.prefix} suffix={s.suffix} />
                </p>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{s.label}</p>
              </motion.div>
            ))}
          </motion.div>
        </Reveal>

        {/* ── What it does ──────────────────────────────────────────────── */}
        <Reveal className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">What it does</h2>
            <p className="text-xs text-muted-foreground mt-1">Four capabilities, one workspace.</p>
          </div>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {capabilities.map((cap) => {
              const Icon = cap.icon;
              return (
                <motion.div
                  key={cap.title}
                  variants={itemVariants}
                  whileHover={{ y: -4 }}
                  className="gradient-card p-5 flex items-start gap-4 h-full"
                >
                  <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0", cap.bg)}>
                    <Icon className={cn("w-5 h-5", cap.color)} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold mb-1">{cap.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{cap.desc}</p>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </Reveal>

        {/* ── Who it's for ──────────────────────────────────────────────── */}
        <Reveal className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Who it&apos;s for</h2>
            <p className="text-xs text-muted-foreground mt-1">Built for the people who live in filings.</p>
          </div>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            {audiences.map((a) => {
              const Icon = a.icon;
              return (
                <motion.div
                  key={a.title}
                  variants={itemVariants}
                  whileHover={{ y: -4 }}
                  className="gradient-card p-6 h-full"
                >
                  <div className="w-11 h-11 rounded-xl bg-fin-500/10 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-fin-400" />
                  </div>
                  <h3 className="text-sm font-semibold mb-1.5">{a.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{a.desc}</p>
                </motion.div>
              );
            })}
          </motion.div>
        </Reveal>

        {/* ── Tech stack ────────────────────────────────────────────────── */}
        <Reveal className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Under the hood</h2>
            <p className="text-xs text-muted-foreground mt-1">
              One PostgreSQL database holds metadata, chunks, the audit log — and the vectors themselves.
            </p>
          </div>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="flex flex-wrap gap-3"
          >
            {stack.map((tech) => {
              const Icon = tech.icon;
              return (
                <motion.div
                  key={tech.label}
                  variants={itemVariants}
                  whileHover={{ scale: 1.05 }}
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-card px-4 py-2"
                >
                  <Icon className={cn("w-4 h-4 flex-shrink-0", tech.tint)} />
                  <span className="text-xs font-medium whitespace-nowrap">{tech.label}</span>
                </motion.div>
              );
            })}
          </motion.div>
        </Reveal>

        {/* ── Creator ───────────────────────────────────────────────────── */}
        <Reveal className="space-y-4 pb-2">
          <h2 className="text-base font-semibold">The maker</h2>
          <motion.div
            whileHover={{ y: -4 }}
            className="gradient-card p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-6"
          >
            <motion.div
              initial={{ scale: 0, rotate: -12 }}
              whileInView={{ scale: 1, rotate: 0 }}
              viewport={{ once: true }}
              transition={{ type: "spring", stiffness: 200, damping: 14 }}
              className="w-20 h-20 rounded-2xl bg-gradient-to-br from-fin-400 to-fin-700 flex items-center justify-center text-2xl font-bold text-white shadow-lg flex-shrink-0"
            >
              DS
            </motion.div>

            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold">Debarghya Sengupta</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Creator &amp; engineer — designed and built Fin-Sight end to end, from the
                RAG pipeline and anomaly detection to the audit trail and this UI.
              </p>

              <div className="flex flex-wrap items-center gap-3 mt-4">
                <Link
                  href="https://github.com/Debarghyasg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm font-medium transition-colors hover:border-fin-500/40 hover:bg-fin-500/10"
                >
                  <GithubIcon className="w-4 h-4" />
                  @Debarghyasg
                  <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>

                <Badge variant="outline" className="gap-1.5">
                  <Lock className="w-3 h-3" />
                  Proprietary · © 2024
                </Badge>
              </div>
            </div>
          </motion.div>

          <p className="text-[11px] text-muted-foreground/70 leading-relaxed max-w-3xl">
            Fin-Sight and all associated source code, design assets, and schemas are the
            exclusive property of the author. This page is informational; see the
            repository LICENSE for usage terms.
          </p>
        </Reveal>
      </div>
    </div>
  );
}
