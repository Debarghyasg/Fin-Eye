"use client";
/**
 * About Fin-Sight — a dedicated, animation-rich info page.
 *
 * Purely informational: it describes the project, who it is for, the
 * technology behind it, headline numbers, and the creator. No data
 * fetching or app state is touched here.
 *
 * Motion design:
 *   - A scroll-progress bar tracks reading position (a MotionValue updated
 *     from the scroll container, so scrolling never triggers a re-render).
 *   - The hero has floating, parallaxed glow orbs and a staggered intro.
 *   - Every section reveals on scroll (`whileInView`, runs once) with an
 *     animated heading underline.
 *   - Cards stagger in, lift + glow on hover; icons react via group-hover.
 *   - Headline metrics count up when scrolled into view (<Counter />).
 *   - The tech stack scrolls as two opposing marquees.
 *   - The creator avatar springs in over an infinite pulsing halo.
 *
 * Layout is overlap-safe: a single `space-y-*` rhythm and grid `gap-*`;
 * every absolutely-positioned element is decorative + `pointer-events-none`.
 */
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  motion,
  useInView,
  useMotionValue,
  useTransform,
  type Variants,
} from "framer-motion";
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

/* ── Animated section heading with a growing underline ─────────────────── */
function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <div className="inline-flex flex-col">
        <h2 className="text-base font-semibold">{title}</h2>
        <motion.span
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
          className="mt-1 h-[3px] w-10 origin-left rounded-full bg-gradient-to-r from-fin-400 to-fin-600"
        />
      </div>
      {subtitle && <p className="text-xs text-muted-foreground mt-2">{subtitle}</p>}
    </div>
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
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ── Variants ──────────────────────────────────────────────────────────── */
const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" } },
};
// Directional entrance — cards slide in from alternating sides.
const directionalVariants: Variants = {
  hidden: (i: number) => ({
    opacity: 0,
    y: 26,
    x: i === 0 ? -26 : i === 2 ? 26 : 0,
  }),
  show: { opacity: 1, x: 0, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

/* ── Count-up number, triggered when scrolled into view ────────────────── */
function Counter({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1.6,
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

  // Scroll progress is tracked with a MotionValue updated from the page's own
  // scroll container. Using a MotionValue (not state) avoids re-rendering the
  // page on every scroll frame — which would otherwise restart the marquees.
  const scrollRef = useRef<HTMLDivElement>(null);
  const progress = useMotionValue(0);
  // Subtle parallax for the hero glow orbs as the page scrolls.
  const orbParallax = useTransform(progress, [0, 1], [0, -120]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    progress.set(max > 0 ? el.scrollTop / max : 0);
  };

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

      {/* Reading-progress bar */}
      <div className="relative h-[3px] w-full bg-white/[0.04] z-10">
        <motion.div
          style={{ scaleX: progress }}
          className="h-full origin-left bg-gradient-to-r from-fin-300 via-fin-400 to-fin-600"
        />
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-10"
      >
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative overflow-hidden gradient-card p-6 sm:p-8 lg:p-12"
        >
          {/* Floating, parallaxed glow orbs */}
          <motion.div
            aria-hidden
            style={{ y: orbParallax }}
            animate={{ scale: [1, 1.12, 1], x: [0, 18, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -top-28 -right-16 w-80 h-80 rounded-full bg-fin-500/15 blur-3xl pointer-events-none"
          />
          <motion.div
            aria-hidden
            animate={{ scale: [1, 1.2, 1], y: [0, -16, 0] }}
            transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="absolute -bottom-32 -left-10 w-72 h-72 rounded-full bg-fin-700/15 blur-3xl pointer-events-none"
          />

          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="relative z-10 max-w-3xl"
          >
            <motion.div variants={itemVariants}>
              <Badge variant="default" className="mb-4 gap-1.5">
                <motion.span
                  animate={{ rotate: [0, 18, -10, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Sparkles className="w-3 h-3" />
                </motion.span>
                Financial Document Intelligence
              </Badge>
            </motion.div>

            <motion.div variants={itemVariants} className="flex items-center gap-3 mb-4">
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                className="relative flex-shrink-0"
              >
                {/* pulsing halo */}
                <motion.span
                  aria-hidden
                  animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 rounded-full bg-fin-500/40 blur-md"
                />
                <Image
                  src="/logo-mark.svg"
                  alt="Fin-Sight"
                  width={46}
                  height={46}
                  className="relative drop-shadow-[0_0_18px_rgba(245,166,35,0.45)]"
                  priority
                />
              </motion.div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Fin<span className="text-fin-400">-</span>Sight
              </h2>
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="text-xl sm:text-2xl font-semibold leading-snug mb-3"
            >
              <span className="text-gradient">
                A production-grade financial RAG platform on a $0/month stack
              </span>
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="text-sm sm:text-base text-muted-foreground leading-relaxed"
            >
              Fin-Sight is a multi-tenant Retrieval-Augmented Generation platform for
              SEC filings. Upload a 10-K, 10-Q, or earnings document, ask a question in
              plain English, and get an answer that points back to the exact page and
              paragraph it came from — with document comparison, anomaly alerts, and
              proactive EDGAR monitoring built in.
            </motion.p>
          </motion.div>
        </motion.section>

        {/* ── By the numbers ────────────────────────────────────────────── */}
        <Reveal className="space-y-4">
          <SectionTitle title="By the numbers" />
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
                whileHover={{ y: -6 }}
                className="group relative gradient-card p-5 h-full overflow-hidden transition-shadow duration-300 hover:shadow-[0_0_24px_rgba(245,166,35,0.18)]"
              >
                {/* top accent line grows on hover */}
                <span className="absolute top-0 left-0 h-[2px] w-full origin-left scale-x-0 bg-gradient-to-r from-fin-400 to-fin-600 transition-transform duration-500 group-hover:scale-x-100" />
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
          <SectionTitle title="What it does" subtitle="Four capabilities, one workspace." />
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
                  whileHover={{ y: -6 }}
                  className="group gradient-card p-5 flex items-start gap-4 h-full transition-shadow duration-300 hover:shadow-[0_0_24px_rgba(245,166,35,0.15)]"
                >
                  <div
                    className={cn(
                      "w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6",
                      cap.bg
                    )}
                  >
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
          <SectionTitle title="Who it's for" subtitle="Built for the people who live in filings." />
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            {audiences.map((a, i) => {
              const Icon = a.icon;
              return (
                <motion.div
                  key={a.title}
                  custom={i}
                  variants={directionalVariants}
                  whileHover={{ y: -6 }}
                  className="group gradient-card p-6 h-full transition-shadow duration-300 hover:shadow-[0_0_24px_rgba(245,166,35,0.15)]"
                >
                  <div className="w-11 h-11 rounded-xl bg-fin-500/10 flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                    <Icon className="w-5 h-5 text-fin-400" />
                  </div>
                  <h3 className="text-sm font-semibold mb-1.5">{a.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{a.desc}</p>
                </motion.div>
              );
            })}
          </motion.div>
        </Reveal>

        {/* ── Tech stack (opposing marquees) ────────────────────────────── */}
        <Reveal className="space-y-4">
          <SectionTitle
            title="Under the hood"
            subtitle="One PostgreSQL database holds metadata, chunks, the audit log — and the vectors themselves."
          />

          <div className="relative space-y-3 overflow-hidden">
            {/* edge fades */}
            <div className="absolute left-0 top-0 bottom-0 w-16 z-10 bg-gradient-to-r from-background to-transparent pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-16 z-10 bg-gradient-to-l from-background to-transparent pointer-events-none" />

            <motion.div
              className="flex gap-3 w-max"
              animate={{ x: ["0%", "-50%"] }}
              transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
            >
              {[...stack, ...stack].map((tech, i) => {
                const Icon = tech.icon;
                return (
                  <div
                    key={`row1-${tech.label}-${i}`}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-card px-4 py-2 flex-shrink-0"
                  >
                    <Icon className={cn("w-4 h-4 flex-shrink-0", tech.tint)} />
                    <span className="text-xs font-medium whitespace-nowrap">{tech.label}</span>
                  </div>
                );
              })}
            </motion.div>

            <motion.div
              className="flex gap-3 w-max"
              animate={{ x: ["-50%", "0%"] }}
              transition={{ duration: 32, repeat: Infinity, ease: "linear" }}
            >
              {[...stack].reverse().concat([...stack].reverse()).map((tech, i) => {
                const Icon = tech.icon;
                return (
                  <div
                    key={`row2-${tech.label}-${i}`}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-card px-4 py-2 flex-shrink-0"
                  >
                    <Icon className={cn("w-4 h-4 flex-shrink-0", tech.tint)} />
                    <span className="text-xs font-medium whitespace-nowrap">{tech.label}</span>
                  </div>
                );
              })}
            </motion.div>
          </div>
        </Reveal>

        {/* ── Creator ───────────────────────────────────────────────────── */}
        <Reveal className="space-y-4 pb-2">
          <SectionTitle title="The maker" />
          <motion.div
            whileHover={{ y: -4 }}
            className="relative gradient-card p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-6 overflow-hidden transition-shadow duration-300 hover:shadow-[0_0_30px_rgba(245,166,35,0.18)]"
          >
            <div className="relative flex-shrink-0">
              {/* infinite pulsing halo behind the avatar */}
              <motion.span
                aria-hidden
                animate={{ scale: [1, 1.25, 1], opacity: [0.45, 0.15, 0.45] }}
                transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -inset-2 rounded-3xl bg-fin-500/40 blur-xl"
              />
              <motion.div
                initial={{ scale: 0, rotate: -16 }}
                whileInView={{ scale: 1, rotate: 0 }}
                viewport={{ once: true }}
                transition={{ type: "spring", stiffness: 200, damping: 13 }}
                whileHover={{ rotate: 6, scale: 1.05 }}
                className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-fin-400 to-fin-700 flex items-center justify-center text-2xl font-bold text-white shadow-lg"
              >
                DS
              </motion.div>
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold">Debarghya Sengupta</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Creator &amp; engineer — designed and built Fin-Sight end to end, from the
                RAG pipeline and anomaly detection to the audit trail and this UI.
              </p>

              <div className="flex flex-wrap items-center gap-3 mt-4">
                <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
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
                </motion.div>

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
