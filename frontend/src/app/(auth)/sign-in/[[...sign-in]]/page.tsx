"use client";
import React from "react";
import { SignIn } from "@clerk/nextjs";
import Image from "next/image";
import { motion } from "framer-motion";
import { useTranslation } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";

/* ── Ticker data ── */
const TICKERS = [
  { sym: "SPX", val: "5,842.31", chg: "+1.24%" },
  { sym: "NDX", val: "20,451.09", chg: "+0.87%" },
  { sym: "BTC", val: "67,320.50", chg: "+2.11%" },
  { sym: "AAPL", val: "214.32", chg: "-0.43%" },
  { sym: "TSLA", val: "182.90", chg: "+3.56%" },
  { sym: "NVDA", val: "875.14", chg: "+1.98%" },
  { sym: "MSFT", val: "415.60", chg: "+0.62%" },
  { sym: "GLD", val: "2,318.40", chg: "+0.19%" },
  { sym: "EUR/USD", val: "1.0841", chg: "-0.12%" },
  { sym: "10Y", val: "4.312%", chg: "+0.04%" },
];

/* ── Candlestick background ── */
const CANDLES = Array.from({ length: 28 }, (_, i) => {
  const open = 40 + Math.random() * 40;
  const close = open + (Math.random() - 0.45) * 20;
  const high = Math.max(open, close) + Math.random() * 10;
  const low = Math.min(open, close) - Math.random() * 10;
  return { open, close, high, low, x: i * 38 + 10 };
});

function CandlestickBg() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.07]"
      viewBox="0 0 1100 200"
      preserveAspectRatio="xMidYMid slice"
    >
      {CANDLES.map((c, i) => {
        const bull = c.close >= c.open;
        const color = bull ? "#22c55e" : "#ef4444";
        const bodyTop = Math.min(c.open, c.close);
        const bodyH = Math.abs(c.close - c.open) || 2;
        return (
          <g key={i}>
            <line x1={c.x} y1={200 - c.high} x2={c.x} y2={200 - c.low} stroke={color} strokeWidth="1" />
            <rect x={c.x - 6} y={200 - bodyTop - bodyH} width={12} height={bodyH} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

/* ── Animated ticker tape ── */
function TickerTape() {
  const doubled = [...TICKERS, ...TICKERS];
  return (
    <div className="absolute top-0 inset-x-0 h-8 overflow-hidden bg-black/40 border-b border-white/[0.06] flex items-center z-10">
      <motion.div
        className="flex gap-8 whitespace-nowrap"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
      >
        {doubled.map((t, i) => (
          <span key={i} className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-white/50">{t.sym}</span>
            <span className="text-white/80">{t.val}</span>
            <span className={t.chg.startsWith("+") ? "text-emerald-400" : "text-red-400"}>
              {t.chg}
            </span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

/* ── Mini sparkline ── */
function Sparkline({ color, up }: { color: string; up: boolean }) {
  const pts = Array.from({ length: 12 }, (_, i) => ({
    x: i * 14,
    y: 20 - (up ? i * 0.8 : -i * 0.8) + (Math.random() - 0.5) * 6,
  }));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return (
    <svg width="70" height="24" viewBox="0 0 154 24">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Floating stat card ── */
function StatCard({
  label, value, chg, up, delay, style,
}: {
  label: string; value: string; chg: string; up: boolean; delay: number; style?: React.CSSProperties;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      style={style}
      className="absolute bg-black/50 border border-white/[0.08] rounded-xl px-3 py-2 backdrop-blur-sm flex items-center gap-3 pointer-events-none"
    >
      <div>
        <p className="text-[10px] text-white/40 font-mono uppercase tracking-widest">{label}</p>
        <p className="text-sm font-semibold text-white font-mono">{value}</p>
        <p className={`text-[11px] font-mono ${up ? "text-emerald-400" : "text-red-400"}`}>{chg}</p>
      </div>
      <Sparkline color={up ? "#22c55e" : "#ef4444"} up={up} />
    </motion.div>
  );
}

/* ── Main ── */
const floatVariants = {
  animate: {
    y: [0, -14, 0],
    transition: { duration: 5, repeat: Infinity, ease: "easeInOut" },
  },
};

const particles = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  x: `${Math.random() * 100}%`,
  y: `${Math.random() * 100}%`,
  duration: 6 + Math.random() * 7,
  delay: Math.random() * 5,
  size: 1 + Math.random() * 1.5,
}));

export default function SignInPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-[#070b0f] flex items-center justify-center relative overflow-hidden">

      {/* Language picker */}
      <div className="absolute top-10 right-4 z-20">
        <LanguageSwitcher />
      </div>

      {/* Ticker tape at top */}
      <TickerTape />

      {/* Candlestick background */}
      <div className="absolute inset-x-0 bottom-0 h-64">
        <CandlestickBg />
      </div>

      {/* Green/red ambient orbs — market colors */}
      <motion.div
        className="absolute rounded-full blur-3xl pointer-events-none"
        style={{ width: 380, height: 380, top: "10%", left: "-8%", background: "rgba(34,197,94,0.07)" }}
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.55, 0.3] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute rounded-full blur-3xl pointer-events-none"
        style={{ width: 280, height: 280, top: "55%", right: "-8%", background: "rgba(239,68,68,0.06)" }}
        animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.45, 0.2] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      />
      <motion.div
        className="absolute rounded-full blur-3xl pointer-events-none"
        style={{ width: 200, height: 200, bottom: "10%", left: "20%", background: "rgba(245,166,35,0.05)" }}
        animate={{ scale: [1, 1.15, 1], opacity: [0.15, 0.35, 0.15] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 3.5 }}
      />

      {/* Grid overlay */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.025 }}
        transition={{ duration: 2 }}
      />

      {/* Sweep shimmer */}
      <motion.div
        className="absolute inset-x-0 pointer-events-none"
        style={{
          height: 1,
          background: "linear-gradient(90deg, transparent, rgba(245,166,35,0.5), transparent)",
          top: "45%",
        }}
        animate={{ x: ["-100%", "200%"] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "linear", repeatDelay: 5 }}
      />

      {/* Floating particles */}
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full pointer-events-none"
          style={{ left: p.x, top: p.y, width: p.size, height: p.size, background: "rgba(245,166,35,0.3)" }}
          animate={{ y: [0, -30, 0], opacity: [0, 0.6, 0] }}
          transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: "easeInOut" }}
        />
      ))}

      {/* Floating stat cards */}
      <StatCard label="S&P 500" value="5,842" chg="+1.24%" up delay={0.8}
        style={{ top: "18%", left: "4%" }}
      />
      <StatCard label="BTC/USD" value="$67,320" chg="+2.11%" up delay={1.0}
        style={{ bottom: "22%", left: "3%" }}
      />
      <StatCard label="10Y Yield" value="4.312%" chg="+0.04bp" up={false} delay={1.2}
        style={{ top: "18%", right: "4%" }}
      />
      <StatCard label="Gold" value="$2,318" chg="+0.19%" up delay={1.4}
        style={{ bottom: "22%", right: "3%" }}
      />

      {/* ── Center content ── */}
      <div className="relative z-10 flex flex-col items-center gap-6 mt-8">

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex flex-col items-center"
        >
          <motion.div variants={floatVariants} animate="animate">
            <Image
              src="/logo-mark.svg"
              alt="Fin-Sight"
              width={56}
              height={56}
              className="drop-shadow-[0_0_30px_rgba(245,166,35,0.6)] mb-2"
              priority
            />
          </motion.div>
          <motion.h1
            className="text-2xl font-bold tracking-tight text-white"
            initial={{ opacity: 0, letterSpacing: "0.3em" }}
            animate={{ opacity: 1, letterSpacing: "-0.02em" }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            Fin<span className="text-[#f5a623]">-</span>Sight
          </motion.h1>
          <motion.p
            className="text-white/40 text-sm mt-1 font-mono tracking-widest uppercase text-[11px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {t("auth.tagline")}
          </motion.p>
        </motion.div>

        {/* Clerk SignIn widget */}
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          whileHover={{ scale: 1.005 }}
        >
          <SignIn
            fallbackRedirectUrl="/home"
            appearance={{
              variables: {
                colorPrimary: "#f5a623",
                colorBackground: "hsl(210 30% 6%)",
                colorInputBackground: "rgba(255,255,255,0.04)",
                colorText: "#f8fafc",
                colorTextSecondary: "#94a3b8",
                colorInputText: "#f8fafc",
                borderRadius: "0.75rem",
              },
              elements: {
                card: "shadow-2xl border border-white/[0.08] backdrop-blur-md",
                headerTitle: "text-white font-semibold",
                headerSubtitle: "text-white/50",
                formButtonPrimary:
                  "bg-[#f5a623] hover:bg-[#f0b843] text-black font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]",
                footerActionLink: "text-[#f5a623] hover:text-[#f0b843] transition-colors duration-150",
                footerActionText: "text-white",
                formFieldLabel: "text-white font-mono text-[12px] tracking-widest uppercase",
                formFieldInput:
                  "border-white/10 bg-white/[0.04] text-white focus:border-[#f5a623]/50 transition-all duration-200 focus:bg-white/[0.07] font-mono",
                dividerLine: "bg-white/[0.07]",
                dividerText: "text-white/30 font-mono text-[11px]",
                socialButtonsBlockButton:
                  "border-white/10 bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]",
              },
            }}
          />
        </motion.div>

        {/* Compliance */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-center text-[11px] text-white/25 font-mono tracking-widest uppercase"
        >
          {t("auth.compliance")}
        </motion.p>
      </div>
    </div>
  );
}