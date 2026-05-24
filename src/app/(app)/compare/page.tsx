"use client";
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, Minus, ArrowRight, Sparkles,
  ChevronDown, FileText, RefreshCw, Download, Info,
  AlertTriangle, PlusCircle, MinusCircle, Edit3,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { mockComparisonData, mockDocuments } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/* ── Selector dropdown ─────────────────────────────────────── */
function DocSelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = [
    { id: "aapl-22", name: "Apple 10-K FY2022", company: "Apple Inc.", period: "FY2022" },
    { id: "aapl-23", name: "Apple 10-K FY2023", company: "Apple Inc.", period: "FY2023" },
    { id: "msft-23", name: "Microsoft 10-K FY2023", company: "Microsoft Corp.", period: "FY2023" },
    { id: "jpm-23", name: "JPMorgan Annual 2023", company: "JPMorgan Chase", period: "FY2023" },
  ];
  const selected = options.find((o) => o.id === value) ?? options[0];

  return (
    <div className="relative flex-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">{label}</p>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-card hover:border-fin-500/30 hover:bg-fin-500/5 transition-all duration-200"
      >
        <div className="w-9 h-9 rounded-lg bg-fin-500/10 flex items-center justify-center flex-shrink-0">
          <FileText className="w-4 h-4 text-fin-400" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-medium truncate">{selected.name}</p>
          <p className="text-xs text-muted-foreground">{selected.company} · {selected.period}</p>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-1 w-full z-50 rounded-xl border border-white/10 bg-popover shadow-2xl overflow-hidden"
          >
            {options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => { onChange(opt.id); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-fin-500/10 transition-colors",
                  opt.id === value && "bg-fin-500/10 text-fin-300"
                )}
              >
                <div className="w-7 h-7 rounded-lg bg-fin-500/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-3.5 h-3.5 text-fin-400" />
                </div>
                <div>
                  <p className="text-xs font-medium">{opt.name}</p>
                  <p className="text-[10px] text-muted-foreground">{opt.company}</p>
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Metric row ────────────────────────────────────────────── */
function MetricRow({
  metric,
  index,
}: {
  metric: (typeof mockComparisonData.metrics)[number];
  index: number;
}) {
  const isUp = metric.direction === "up";
  const isFlat = Math.abs(metric.delta) < 0.5;
  const DeltaIcon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;
  const deltaColor = isUp ? "text-emerald-400" : "text-red-400";
  const deltaBg = isUp ? "bg-emerald-500/10" : "bg-red-500/10";

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-4 py-3.5 border-b border-white/[0.05] last:border-0 group hover:bg-white/[0.02] rounded-lg px-2 -mx-2 transition-colors"
    >
      {/* Value A */}
      <div className="text-right">
        <p className="font-semibold text-foreground text-sm">{metric.valueA}</p>
        <p className="text-[10px] text-muted-foreground">FY2022</p>
      </div>

      {/* Label + delta */}
      <div className="flex flex-col items-center gap-1 min-w-[130px]">
        <p className="text-xs text-muted-foreground text-center font-medium">{metric.label}</p>
        <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold", deltaBg, deltaColor)}>
          <DeltaIcon className="w-3 h-3" />
          {isUp ? "+" : ""}{metric.delta.toFixed(1)}%
        </div>
      </div>

      {/* Value B */}
      <div className="text-left">
        <p className="font-semibold text-foreground text-sm">{metric.valueB}</p>
        <p className="text-[10px] text-muted-foreground">FY2023</p>
      </div>

      {/* Delta bar */}
      <div className="w-24 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(Math.abs(metric.delta) * 4, 100)}%` }}
          transition={{ duration: 0.8, delay: index * 0.05 + 0.3 }}
          className={cn("h-full rounded-full", isUp ? "bg-emerald-400" : "bg-red-400")}
        />
      </div>
    </motion.div>
  );
}

/* ── Risk change pill ──────────────────────────────────────── */
const riskConfig = {
  new: { icon: PlusCircle, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", label: "New" },
  expanded: { icon: Edit3, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", label: "Expanded" },
  removed: { icon: MinusCircle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", label: "Removed" },
  modified: { icon: AlertTriangle, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", label: "Modified" },
};

function RiskChangeRow({
  change,
  index,
}: {
  change: (typeof mockComparisonData.riskChanges)[number];
  index: number;
}) {
  const cfg = riskConfig[change.type];
  const Icon = cfg.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className={cn("flex gap-3 p-3.5 rounded-xl border", cfg.bg)}
    >
      <Icon className={cn("w-4 h-4 flex-shrink-0 mt-0.5", cfg.color)} />
      <div className="min-w-0">
        <span className={cn("text-[10px] font-bold uppercase tracking-wide", cfg.color)}>{cfg.label}</span>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{change.text}</p>
      </div>
    </motion.div>
  );
}

/* ── Sentiment gauge ───────────────────────────────────────── */
function SentimentGauge({ label, score, prev }: { label: string; score: number; prev?: number }) {
  const pct = score * 100;
  const color = score >= 0.7 ? "from-emerald-500 to-fin-400" : score >= 0.5 ? "from-amber-500 to-yellow-400" : "from-red-500 to-rose-400";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-2">
          {prev !== undefined && (
            <span className={cn("text-xs font-medium", score > prev ? "text-emerald-400" : "text-red-400")}>
              {score > prev ? "+" : ""}{((score - prev) * 100).toFixed(0)}pts
            </span>
          )}
          <span className="text-sm font-bold text-foreground">{pct.toFixed(0)}</span>
        </div>
      </div>
      <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={cn("h-full rounded-full bg-gradient-to-r", color)}
        />
      </div>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────── */
export default function ComparePage() {
  const [docA, setDocA] = useState("aapl-22");
  const [docB, setDocB] = useState("aapl-23");
  const [isRunning, setIsRunning] = useState(false);
  const [hasResults, setHasResults] = useState(true);
  const data = mockComparisonData;

  const runComparison = async () => {
    setIsRunning(true);
    setHasResults(false);
    await new Promise((r) => setTimeout(r, 2200));
    setIsRunning(false);
    setHasResults(true);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Document Comparison"
        subtitle="AI-powered side-by-side financial document analysis"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Document selector row */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="gradient-card p-5"
        >
          <div className="flex items-end gap-4">
            <DocSelector label="Document A (Baseline)" value={docA} onChange={setDocA} />

            <div className="flex-shrink-0 pb-1">
              <motion.div
                animate={{ x: [0, 4, 0] }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              >
                <ArrowRight className="w-5 h-5 text-fin-400" />
              </motion.div>
            </div>

            <DocSelector label="Document B (Compare)" value={docB} onChange={setDocB} />

            <Button
              variant="glow"
              className="flex-shrink-0 gap-2 mb-0.5"
              onClick={runComparison}
              disabled={isRunning}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Run Comparison
                </>
              )}
            </Button>

            <Button variant="outline" size="icon" className="flex-shrink-0 mb-0.5">
              <Download className="w-4 h-4" />
            </Button>
          </div>

          {/* Running progress */}
          <AnimatePresence>
            {isRunning && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 overflow-hidden"
              >
                <div className="space-y-2">
                  {[
                    "Extracting financial tables from both documents…",
                    "Running semantic similarity on risk factor sections…",
                    "Computing metric deltas and YoY changes…",
                    "Analyzing management tone with sentiment model…",
                    "Generating comparison report…",
                  ].map((step, i) => (
                    <motion.div
                      key={step}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.35 }}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear", delay: i * 0.35 }}
                        className="w-3 h-3 border border-fin-500/40 border-t-fin-400 rounded-full"
                      />
                      {step}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Results */}
        <AnimatePresence>
          {hasResults && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Tabs defaultValue="metrics">
                <TabsList className="mb-4">
                  <TabsTrigger value="metrics">Financial Metrics</TabsTrigger>
                  <TabsTrigger value="risk">Risk Factor Changes</TabsTrigger>
                  <TabsTrigger value="sentiment">Sentiment Analysis</TabsTrigger>
                  <TabsTrigger value="narrative">AI Narrative</TabsTrigger>
                </TabsList>

                {/* ── Metrics tab ── */}
                <TabsContent value="metrics">
                  <div className="gradient-card p-6">
                    {/* Summary pills */}
                    <div className="flex items-center gap-3 mb-6 flex-wrap">
                      <span className="text-sm font-semibold">
                        {data.docA.company} · {data.docA.period} vs {data.docB.period}
                      </span>
                      <div className="flex gap-2 ml-auto">
                        {[
                          { label: `${data.metrics.filter(m => m.direction === "up").length} Improved`, color: "success" as const },
                          { label: `${data.metrics.filter(m => m.direction === "down").length} Declined`, color: "destructive" as const },
                        ].map((pill) => (
                          <Badge key={pill.label} variant={pill.color}>{pill.label}</Badge>
                        ))}
                      </div>
                    </div>

                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-4 mb-2 px-2">
                      <p className="text-right text-[10px] text-muted-foreground uppercase tracking-wide">{data.docA.period}</p>
                      <p className="text-center text-[10px] text-muted-foreground uppercase tracking-wide w-[130px]">Metric · Δ</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{data.docB.period}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide w-24">Magnitude</p>
                    </div>

                    {data.metrics.map((metric, i) => (
                      <MetricRow key={metric.label} metric={metric} index={i} />
                    ))}
                  </div>
                </TabsContent>

                {/* ── Risk tab ── */}
                <TabsContent value="risk">
                  <div className="gradient-card p-6 space-y-3">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-semibold text-sm">Risk Factor Language Changes</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Detected {data.riskChanges.length} material changes between filings
                        </p>
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        {(["new", "expanded", "removed", "modified"] as const).map((type) => {
                          const cfg = riskConfig[type];
                          const count = data.riskChanges.filter((r) => r.type === type).length;
                          if (!count) return null;
                          return (
                            <Badge key={type} variant="outline" className={cn("text-[10px]", cfg.color)}>
                              {cfg.label}: {count}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    {data.riskChanges.map((change, i) => (
                      <RiskChangeRow key={i} change={change} index={i} />
                    ))}
                  </div>
                </TabsContent>

                {/* ── Sentiment tab ── */}
                <TabsContent value="sentiment">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="gradient-card p-6 space-y-5">
                      <div>
                        <h3 className="font-semibold text-sm mb-1">Management Tone Score</h3>
                        <p className="text-xs text-muted-foreground">Based on earnings call transcript & MD&A language</p>
                      </div>
                      <SentimentGauge
                        label={`${data.docA.period} Baseline`}
                        score={data.sentimentShift.score2022}
                      />
                      <SentimentGauge
                        label={`${data.docB.period} Current`}
                        score={data.sentimentShift.score2023}
                        prev={data.sentimentShift.score2022}
                      />
                      <div className={cn(
                        "rounded-xl p-3.5 border text-sm",
                        data.sentimentShift.change < 0
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                          : "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                      )}>
                        <p className="font-semibold text-xs uppercase tracking-wide mb-1">AI Interpretation</p>
                        {data.sentimentShift.change < 0
                          ? "Management tone has shifted toward increased caution. Guidance language uses more hedging terms (+23%) and uncertainty qualifiers compared to the prior year filing."
                          : "Management tone reflects increased confidence. Forward-looking statements use more affirmative language compared to the prior year."}
                      </div>
                    </div>

                    <div className="gradient-card p-6 space-y-4">
                      <h3 className="font-semibold text-sm">Linguistic Breakdown</h3>
                      {[
                        { label: "Confidence Language", a: 72, b: 58 },
                        { label: "Hedging Phrases", a: 28, b: 45 },
                        { label: "Forward Guidance", a: 64, b: 61 },
                        { label: "Risk Acknowledgement", a: 41, b: 53 },
                        { label: "Positive Outlook", a: 69, b: 55 },
                      ].map((row, i) => (
                        <motion.div
                          key={row.label}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.1 }}
                          className="space-y-1.5"
                        >
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{row.label}</span>
                            <span className="text-muted-foreground">{data.docA.period}: {row.a} · {data.docB.period}: {row.b}</span>
                          </div>
                          <div className="flex gap-1 h-1.5">
                            <div className="flex-1 rounded-full bg-white/[0.06] overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${row.a}%` }}
                                transition={{ duration: 0.8, delay: i * 0.1 }}
                                className="h-full bg-fin-500/60 rounded-full"
                              />
                            </div>
                            <div className="flex-1 rounded-full bg-white/[0.06] overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${row.b}%` }}
                                transition={{ duration: 0.8, delay: i * 0.1 + 0.1 }}
                                className={cn("h-full rounded-full", row.b > row.a ? "bg-emerald-400/60" : "bg-red-400/60")}
                              />
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </TabsContent>

                {/* ── Narrative tab ── */}
                <TabsContent value="narrative">
                  <div className="gradient-card p-6 space-y-5">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fin-400 to-fin-700 flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(34,162,105,0.3)]">
                        <Sparkles className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">AI Comparison Summary</p>
                        <p className="text-xs text-muted-foreground">Generated by GPT-4o · Cross-encoder re-ranked sources</p>
                      </div>
                    </div>

                    {[
                      {
                        title: "Revenue & Profitability",
                        body: "Apple's FY2023 results reflect a modest revenue contraction of 2.8% ($383.3B vs $394.3B), driven primarily by hardware headwinds in iPhone and Mac segments. However, gross margin expanded 80bps to 44.1%, suggesting improving product mix and cost discipline. Services revenue reached a record $85.2B, growing 9.1% YoY and now representing 22.2% of total revenue — up from 19.8% in FY2022. This structural shift toward high-margin recurring revenue is a material positive for long-term earnings quality.",
                      },
                      {
                        title: "Capital Allocation",
                        body: "Free cash flow declined 6.7% to $99.6B, partly due to the 13.7% increase in R&D expenditure ($29.9B). The company returned $89.3B to shareholders via buybacks and dividends. The elevated R&D spend appears correlated with accelerated investments in silicon (M-series chips, Vision Pro), generative AI capabilities, and health technology — positioning that should create defensible competitive advantages, consistent with the new risk factor language added around AI competition.",
                      },
                      {
                        title: "Risk Profile Evolution",
                        body: "The risk factor section underwent four material changes. The introduction of a generative AI competition risk factor is particularly notable — Apple explicitly acknowledges that third-party AI integration into its platforms creates competitive uncertainty. The expansion of TSMC dependency language (+34%) reflects ongoing supply concentration concerns despite diversification efforts. The removal of COVID-19 from primary risks marks a normalization of operational conditions. Net risk posture is slightly elevated versus FY2022, consistent with the decline in management sentiment scores.",
                      },
                    ].map((section, i) => (
                      <motion.div
                        key={section.title}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.15 }}
                        className="border-l-2 border-fin-500/30 pl-4"
                      >
                        <p className="text-sm font-semibold text-fin-300 mb-1">{section.title}</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">{section.body}</p>
                      </motion.div>
                    ))}

                    <div className="flex items-center gap-2 pt-2 border-t border-white/[0.07]">
                      <Info className="w-3.5 h-3.5 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">
                        Sources: Apple 10-K FY2022 (pp. 18–72), Apple 10-K FY2023 (pp. 16–69) · Confidence: 94%
                      </p>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
