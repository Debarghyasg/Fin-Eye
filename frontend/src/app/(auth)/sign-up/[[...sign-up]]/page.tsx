"use client";
import { SignUp } from "@clerk/nextjs";
import Image from "next/image";
import { motion } from "framer-motion";
import { Check, TrendingUp, BarChart2, Shield, Zap, Globe } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";

const FEATURE_KEYS = [
  "auth.feature1",
  "auth.feature2",
  "auth.feature3",
  "auth.feature4",
  "auth.feature5",
];

const FEATURE_ICONS = [TrendingUp, BarChart2, Shield, Zap, Globe];

/* ── Ticker tape ── */
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

function TickerTape() {
  const doubled = [...TICKERS, ...TICKERS];
  return (
    <div className="absolute top-0 inset-x-0 h-8 overflow-hidden bg-black/50 border-b border-white/[0.06] flex items-center z-20">
      <motion.div
        className="flex gap-8 whitespace-nowrap"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
      >
        {doubled.map((t, i) => (
          <span key={i} className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-white/40">{t.sym}</span>
            <span className="text-white/70">{t.val}</span>
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
function Sparkline({ up }: { up: boolean }) {
  const color = up ? "#22c55e" : "#ef4444";
  const pts = Array.from({ length: 10 }, (_, i) => ({
    x: i * 10,
    y: 16 - (up ? i * 0.9 : -i * 0.9) + (Math.random() - 0.5) * 5,
  }));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return (
    <svg width="60" height="20" viewBox="0 0 90 20">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Market stat row ── */
function MarketStat({ sym, val, chg, up, delay }: { sym: string; val: string; chg: string; up: boolean; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="flex items-center justify-between py-2 border-b border-white/[0.05]"
    >
      <div className="flex items-center gap-3">
        <div className={`w-1.5 h-6 rounded-full ${up ? "bg-emerald-500" : "bg-red-500"}`} />
        <div>
          <p className="text-[11px] text-white/40 font-mono uppercase tracking-widest">{sym}</p>
          <p className="text-sm font-semibold text-white font-mono">{val}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Sparkline up={up} />
        <span className={`text-xs font-mono font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}>{chg}</span>
      </div>
    </motion.div>
  );
}

/* ── Candlestick SVG ── */
const CANDLES = Array.from({ length: 20 }, () => {
  const open = 30 + Math.random() * 50;
  const close = open + (Math.random() - 0.45) * 18;
  const high = Math.max(open, close) + Math.random() * 8;
  const low = Math.min(open, close) - Math.random() * 8;
  return { open, close, high, low };
});

function CandleChart() {
  return (
    <svg viewBox="0 0 420 100" className="w-full opacity-20" preserveAspectRatio="none">
      {CANDLES.map((c, i) => {
        const bull = c.close >= c.open;
        const color = bull ? "#22c55e" : "#ef4444";
        const x = i * 21 + 10;
        const bodyTop = Math.min(c.open, c.close);
        const bodyH = Math.abs(c.close - c.open) || 2;
        return (
          <g key={i}>
            <line x1={x} y1={100 - c.high} x2={x} y2={100 - c.low} stroke={color} strokeWidth="1" />
            <rect x={x - 7} y={100 - bodyTop - bodyH} width={14} height={bodyH} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

const particles = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  x: `${Math.random() * 100}%`,
  y: `${Math.random() * 100}%`,
  duration: 6 + Math.random() * 6,
  delay: Math.random() * 4,
  size: 1 + Math.random() * 1.5,
}));

const floatVariants = {
  animate: {
    y: [0, -10, 0],
    transition: { duration: 5, repeat: Infinity, ease: "easeInOut" },
  },
};

export default function SignUpPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-[#070b0f] flex overflow-hidden relative">

      {/* Language picker */}
      <div className="absolute top-10 right-4 z-30">
        <LanguageSwitcher />
      </div>

      {/* Ticker tape */}
      <TickerTape />

      {/* Floating particles */}
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full pointer-events-none z-0"
          style={{ left: p.x, top: p.y, width: p.size, height: p.size, background: "rgba(245,166,35,0.25)" }}
          animate={{ y: [0, -28, 0], opacity: [0, 0.5, 0] }}
          transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: "easeInOut" }}
        />
      ))}

      {/* ── LEFT PANEL ── */}
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        className="hidden lg:flex lg:w-[48%] flex-col justify-between pt-16 pb-10 px-10 border-r border-white/[0.06] relative overflow-hidden"
      >
        {/* Grid */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",
            backgroundSize: "50px 50px",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.025 }}
          transition={{ duration: 2 }}
        />

        {/* Orb */}
        <motion.div
          className="absolute top-0 left-0 w-80 h-80 rounded-full blur-3xl pointer-events-none -translate-x-1/2 -translate-y-1/2"
          style={{ background: "rgba(34,197,94,0.08)" }}
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 7, repeat: Infinity }}
        />
        <motion.div
          className="absolute bottom-0 right-0 w-56 h-56 rounded-full blur-3xl pointer-events-none"
          style={{ background: "rgba(245,166,35,0.06)" }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 8, repeat: Infinity, delay: 3 }}
        />

        {/* Logo */}
        <motion.div
          className="relative z-10 flex items-center gap-3"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          <motion.div variants={floatVariants} animate="animate">
            <Image
              src="/logo-mark.svg"
              alt="Fin-Sight"
              width={42}
              height={42}
              className="drop-shadow-[0_0_18px_rgba(245,166,35,0.5)]"
              priority
            />
          </motion.div>
          <motion.span
            className="text-xl font-bold text-white"
            initial={{ opacity: 0, letterSpacing: "0.2em" }}
            animate={{ opacity: 1, letterSpacing: "-0.02em" }}
            transition={{ duration: 0.7, delay: 0.3 }}
          >
            Fin<span className="text-[#f5a623]">-</span>Sight
          </motion.span>
        </motion.div>

        {/* Headline */}
        <div className="relative z-10">
          <motion.p
            className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#f5a623]/60 mb-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            Market Intelligence
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.55 }}
            className="text-3xl font-bold mb-2 leading-tight text-white"
          >
            {t("auth.institutionalGrade")}
            <br />
            <span className="text-[#f5a623]">{t("auth.forAnalysts")}</span>
          </motion.h2>
          <motion.p
            className="text-white/40 mb-6 leading-relaxed text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
          >
            {t("auth.queryDesc")}
          </motion.p>

          {/* Live market stats */}
          <motion.div
            className="mb-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">Live Markets</p>
            <MarketStat sym="S&P 500" val="5,842.31" chg="+1.24%" up delay={0.55} />
            <MarketStat sym="NASDAQ" val="20,451.09" chg="+0.87%" up delay={0.62} />
            <MarketStat sym="10Y Yield" val="4.312%" chg="+0.04bp" up={false} delay={0.69} />
            <MarketStat sym="Gold" val="$2,318.40" chg="+0.19%" up delay={0.76} />
          </motion.div>

          {/* Candle chart */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.85 }}
            className="mb-6"
          >
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">Portfolio Performance</p>
            <CandleChart />
          </motion.div>

          {/* Features */}
          <div className="space-y-2.5">
            {FEATURE_KEYS.map((f, i) => {
              const Icon = FEATURE_ICONS[i];
              return (
                <motion.div
                  key={f}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.9 + i * 0.08 }}
                  className="flex items-center gap-3"
                  whileHover={{ x: 4 }}
                >
                  <div className="w-5 h-5 rounded bg-[#f5a623]/10 border border-[#f5a623]/25 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3 h-3 text-[#f5a623]" />
                  </div>
                  <span className="text-xs text-white/40">{t(f)}</span>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Testimonial */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3 }}
          whileHover={{ scale: 1.02 }}
          className="relative z-10"
        >
          <div className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-[#f5a623]/20 transition-colors duration-300">
            <motion.div
              className="w-10 h-10 rounded-full bg-gradient-to-br from-[#f5a623] to-[#c47d10] flex items-center justify-center text-xs font-bold text-black flex-shrink-0"
              animate={{ boxShadow: ["0 0 0px rgba(245,166,35,0)", "0 0 14px rgba(245,166,35,0.4)", "0 0 0px rgba(245,166,35,0)"] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              JP
            </motion.div>
            <div>
              <p className="text-xs font-medium text-white/80">{t("auth.testimonial")}</p>
              <p className="text-[11px] text-white/30 font-mono mt-0.5">{t("auth.testimonialAuthor")}</p>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex-1 flex items-center justify-center p-6 pt-14 relative z-10">

        {/* Right-side ambient orbs */}
        <motion.div
          className="absolute rounded-full blur-3xl pointer-events-none"
          style={{ width: 300, height: 300, top: "15%", right: "-5%", background: "rgba(239,68,68,0.05)" }}
          animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 8, repeat: Infinity, delay: 1 }}
        />

        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center gap-5 w-full max-w-md"
          whileHover={{ scale: 1.004 }}
        >
          {/* Mobile logo */}
          <motion.div
            className="flex lg:hidden items-center gap-2"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Image src="/logo-mark.svg" alt="Fin-Sight" width={36} height={36} priority />
            <span className="text-lg font-bold text-white">
              Fin<span className="text-[#f5a623]">-</span>Sight
            </span>
          </motion.div>

          <SignUp
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
                footerActionText: "text-white",
                formFieldLabel: "text-white font-mono text-[12px] tracking-widest uppercase",
                headerTitle: "text-white font-semibold",
                headerSubtitle: "text-white/50",
                formButtonPrimary:
                  "bg-[#f5a623] hover:bg-[#f0b843] text-black font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]",
                footerActionLink: "text-[#f5a623] hover:text-[#f0b843] transition-colors duration-150",
                formFieldInput:
                  "border-white/10 bg-white/[0.04] text-white focus:border-[#f5a623]/50 transition-all duration-200 focus:bg-white/[0.07] font-mono",
                dividerLine: "bg-white/[0.07]",
                dividerText: "text-white/30 font-mono text-[11px]",
                socialButtonsBlockButton:
                  "border-white/10 bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]",
              },
            }}
          />

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="text-center text-[10px] text-white/20 font-mono tracking-widest uppercase"
          >
            {t("auth.compliance")}
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}