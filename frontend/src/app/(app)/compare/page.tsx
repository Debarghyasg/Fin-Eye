"use client";
/**
 * Compare page — Phase 4 Week 8 Day 1-3.
 *
 * Two document selectors (now sourced from the live document store, not
 * a hard-coded list) and a "Run Comparison" button that POSTs to
 * /api/v1/comparisons + polls until status="completed".
 *
 * Live and mock paths share the UI via the comparison-adapter normaliser.
 * In mock mode (NEXT_PUBLIC_API_URL unset) we still simulate the spinner
 * and progress steps so the demo experience matches the live one.
 */
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, Minus, ArrowRight, Sparkles,
  ChevronDown, FileText, RefreshCw, Download, Info,
  AlertTriangle, PlusCircle, MinusCircle, Edit3, AlertCircle,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  IS_LIVE_API,
  ApiError,
  createComparison,
  pollComparison,
} from "@/lib/api";
import {
  adaptLiveComparison,
  adaptMockComparison,
  type NormalisedComparison,
  type NormalisedMetric,
  type NormalisedRiskChange,
} from "@/lib/comparison-adapter";
import { mockComparisonData } from "@/lib/mock-data";
import { cn, sleep } from "@/lib/utils";
import { useAppStore, type Document } from "@/store/useAppStore";

/* ── Selector dropdown — now backed by the document store ──────────────── */
interface DocSelectorProps {
  label: string;
  selected: Document | null;
  options: Document[];
  onChange: (doc: Document) => void;
  excludeId?: string;
}

function DocSelector({ label, selected, options, onChange, excludeId }: DocSelectorProps) {
  const [open, setOpen] = useState(false);
  const filtered = options.filter((o) => o.id !== excludeId);

  return (
    <div className="relative flex-1 min-w-0">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">{label}</p>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-card hover:border-fin-500/30 hover:bg-fin-500/5 transition-all duration-200"
      >
        <div className="w-9 h-9 rounded-lg bg-fin-500/10 flex items-center justify-center flex-shrink-0">
          <FileText className="w-4 h-4 text-fin-400" />
        </div>
        <div className="flex-1 text-left min-w-0">
          {selected ? (
            <>
              <p className="text-sm font-medium truncate">{selected.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {selected.company} · {selected.type}
                {selected.ticker ? ` · ${selected.ticker}` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic">Select a document…</p>
          )}
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform duration-200 flex-shrink-0",
            open && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-1 w-full z-50 rounded-xl border border-white/10 bg-popover shadow-2xl overflow-hidden max-h-72 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-xs text-muted-foreground text-center">
                No other indexed documents available
              </p>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-fin-500/10 transition-colors",
                    opt.id === selected?.id && "bg-fin-500/10 text-fin-300"
                  )}
                >
                  <div className="w-7 h-7 rounded-lg bg-fin-500/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-3.5 h-3.5 text-fin-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{opt.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {opt.company} · {opt.ticker}
                    </p>
                  </div>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Metric row ────────────────────────────────────────────────────────── */
function MetricRow({ metric, index }: { metric: NormalisedMetric; index: number }) {
  const isFlat = metric.direction === "flat";
  const isUp = metric.direction === "up";
  const DeltaIcon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;
  const deltaColor = isUp ? "text-emerald-400" : isFlat ? "text-muted-foreground" : "text-red-400";
  const deltaBg = isUp ? "bg-emerald-500/10" : isFlat ? "bg-white/[0.05]" : "bg-red-500/10";
  const deltaText =
    metric.delta === null ? "n/a" : `${isUp ? "+" : ""}${metric.delta.toFixed(1)}%`;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-4 py-3.5 border-b border-white/[0.05] last:border-0 group hover:bg-white/[0.02] rounded-lg px-2 -mx-2 transition-colors"
    >
      <div className="text-right">
        <p className="font-semibold text-foreground text-sm">{metric.valueA}</p>
        <p className="text-[10px] text-muted-foreground">Period A</p>
      </div>

      <div className="flex flex-col items-center gap-1 min-w-[140px]">
        <p className="text-xs text-muted-foreground text-center font-medium">{metric.name}</p>
        <div
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold",
            deltaBg,
            deltaColor
          )}
        >
          <DeltaIcon className="w-3 h-3" />
          {deltaText}
        </div>
      </div>

      <div className="text-left">
        <p className="font-semibold text-foreground text-sm">{metric.valueB}</p>
        <p className="text-[10px] text-muted-foreground">Period B</p>
      </div>

      <div className="w-24 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{
            width:
              metric.delta === null
                ? "0%"
                : `${Math.min(Math.abs(metric.delta) * 4, 100)}%`,
          }}
          transition={{ duration: 0.8, delay: index * 0.05 + 0.3 }}
          className={cn(
            "h-full rounded-full",
            isUp ? "bg-emerald-400" : isFlat ? "bg-muted-foreground/40" : "bg-red-400"
          )}
        />
      </div>
    </motion.div>
  );
}

/* ── Risk change pill ──────────────────────────────────────────────────── */
const riskConfig = {
  new: {
    icon: PlusCircle,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    label: "New",
  },
  expanded: {
    icon: Edit3,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    label: "Expanded",
  },
  removed: {
    icon: MinusCircle,
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    label: "Removed",
  },
  modified: {
    icon: AlertTriangle,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    label: "Modified",
  },
} as const;

function RiskChangeRow({ change, index }: { change: NormalisedRiskChange; index: number }) {
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
        <span className={cn("text-[10px] font-bold uppercase tracking-wide", cfg.color)}>
          {cfg.label}
        </span>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{change.text}</p>
      </div>
    </motion.div>
  );
}

/* ── Sentiment gauge ───────────────────────────────────────────────────── */
function SentimentGauge({
  label,
  score,
  prev,
}: {
  label: string;
  score: number;
  prev?: number;
}) {
  const pct = score * 100;
  const color =
    score >= 0.7
      ? "from-emerald-500 to-fin-400"
      : score >= 0.5
        ? "from-amber-500 to-yellow-400"
        : "from-red-500 to-rose-400";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-2">
          {prev !== undefined && (
            <span
              className={cn(
                "text-xs font-medium",
                score > prev ? "text-emerald-400" : "text-red-400"
              )}
            >
              {score > prev ? "+" : ""}
              {((score - prev) * 100).toFixed(0)}pts
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

/* ── Run progress steps ───────────────────────────────────────────────── */
const PROGRESS_STEPS_LIVE = [
  "Submitting comparison request…",
  "Extracting financial metrics with GPT-4o…",
  "Diffing metrics + risk-factor sets…",
  "Running FinBERT sentiment analysis…",
  "Generating AI narrative summary…",
  "Wrapping up…",
];

const PROGRESS_STEPS_MOCK = [
  "Extracting financial tables from both documents…",
  "Running semantic similarity on risk factor sections…",
  "Computing metric deltas and YoY changes…",
  "Analyzing management tone with sentiment model…",
  "Generating comparison report…",
];

/* ── Main page ─────────────────────────────────────────────────────────── */
export default function ComparePage() {
  const documents = useAppStore((s) => s.documents);

  // Only indexed docs are eligible for comparison
  const indexedDocs = useMemo(
    () => documents.filter((d) => d.status === "indexed"),
    [documents]
  );

  const [docA, setDocA] = useState<Document | null>(null);
  const [docB, setDocB] = useState<Document | null>(null);

  // Default: pick the first two indexed docs, but only on mount + when no
  // selection exists yet (so re-renders don't override user choices)
  useEffect(() => {
    if (!docA && indexedDocs[0]) setDocA(indexedDocs[0]);
    if (!docB && indexedDocs[1]) setDocB(indexedDocs[1] ?? indexedDocs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexedDocs.length]);

  const [comparison, setComparison] = useState<NormalisedComparison | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const stepsForRun = IS_LIVE_API ? PROGRESS_STEPS_LIVE : PROGRESS_STEPS_MOCK;

  // Show the seed mock comparison on first render so the page never feels empty
  useEffect(() => {
    if (!comparison) {
      setComparison(adaptMockComparison(mockComparisonData));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runComparison = async () => {
    if (!docA || !docB) return;
    if (docA.id === docB.id) {
      setRunError("Pick two different documents to compare.");
      return;
    }

    setIsRunning(true);
    setRunError(null);
    setActiveStepIdx(0);
    setComparison(null);

    if (!IS_LIVE_API) {
      // Mock path: keep the existing demo experience
      for (let i = 0; i < PROGRESS_STEPS_MOCK.length; i++) {
        setActiveStepIdx(i);
        await sleep(420);
      }
      setComparison(adaptMockComparison(mockComparisonData));
      setIsRunning(false);
      return;
    }

    // Live path: POST + poll
    try {
      setActiveStepIdx(0);
      const initial = await createComparison({
        document_a_id: docA.id,
        document_b_id: docB.id,
        include_sentiment: true,
        include_narrative: true,
      });
      // 201 returns "processing" — render the partial then poll
      setComparison(adaptLiveComparison(initial));

      const final = await pollComparison(initial.comparison_id, {
        onTick: (_result, attempt) => {
          // Advance the displayed step every poll tick (cap at last step)
          setActiveStepIdx((prev) =>
            Math.min(prev + 1, PROGRESS_STEPS_LIVE.length - 1)
          );
        },
      });

      if (final.status === "failed") {
        setRunError(final.error_message ?? "Comparison failed.");
        setComparison(adaptLiveComparison(final));
      } else {
        setComparison(adaptLiveComparison(final));
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : (err as Error).message;
      setRunError(message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Document Comparison"
        subtitle="AI-powered side-by-side financial document analysis"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* ── Selector + run button ─────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="gradient-card p-5"
        >
          <div className="flex items-end gap-4">
            <DocSelector
              label="Document A (Baseline)"
              selected={docA}
              options={indexedDocs}
              onChange={setDocA}
              excludeId={docB?.id}
            />

            <div className="flex-shrink-0 pb-1">
              <motion.div
                animate={{ x: [0, 4, 0] }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              >
                <ArrowRight className="w-5 h-5 text-fin-400" />
              </motion.div>
            </div>

            <DocSelector
              label="Document B (Compare)"
              selected={docB}
              options={indexedDocs}
              onChange={setDocB}
              excludeId={docA?.id}
            />

            <Button
              variant="glow"
              className="flex-shrink-0 gap-2 mb-0.5"
              onClick={runComparison}
              disabled={isRunning || !docA || !docB}
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

          {/* Live API hint */}
          {!IS_LIVE_API && (
            <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
              <Info className="w-3 h-3" />
              <span>
                Demo mode — using mock comparison data. Set NEXT_PUBLIC_API_URL
                to point at a backend to run real GPT-4o + FinBERT comparisons.
              </span>
            </div>
          )}

          {/* Run error */}
          <AnimatePresence>
            {runError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">{runError}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

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
                  {stepsForRun.map((step, i) => {
                    const done = i < activeStepIdx;
                    const active = i === activeStepIdx;
                    return (
                      <motion.div
                        key={step}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{
                          opacity: i <= activeStepIdx ? 1 : 0.4,
                          x: 0,
                        }}
                        transition={{ delay: i * 0.05 }}
                        className={cn(
                          "flex items-center gap-2 text-xs",
                          done
                            ? "text-fin-300"
                            : active
                              ? "text-foreground"
                              : "text-muted-foreground"
                        )}
                      >
                        {done ? (
                          <span className="w-3 h-3 rounded-full bg-fin-500/30 border border-fin-500/60 flex items-center justify-center">
                            <span className="w-1 h-1 rounded-full bg-fin-400" />
                          </span>
                        ) : active ? (
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-3 h-3 border border-fin-500/40 border-t-fin-400 rounded-full"
                          />
                        ) : (
                          <span className="w-3 h-3 rounded-full border border-white/10" />
                        )}
                        {step}
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Results ───────────────────────────────────────────────────── */}
        <AnimatePresence>
          {comparison && comparison.status !== "processing" && !isRunning && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Tabs defaultValue="metrics">
                <TabsList className="mb-4">
                  <TabsTrigger value="metrics">
                    Financial Metrics ({comparison.metrics.length})
                  </TabsTrigger>
                  <TabsTrigger value="risk">
                    Risk Factor Changes ({comparison.riskChanges.length})
                  </TabsTrigger>
                  <TabsTrigger value="sentiment" disabled={!comparison.sentiment}>
                    Sentiment Analysis
                  </TabsTrigger>
                  <TabsTrigger value="narrative" disabled={!comparison.narrative}>
                    AI Narrative
                  </TabsTrigger>
                </TabsList>

                {/* ── Metrics tab ── */}
                <TabsContent value="metrics">
                  <div className="gradient-card p-6">
                    <div className="flex items-center gap-3 mb-6 flex-wrap">
                      <span className="text-sm font-semibold">
                        {comparison.documentA.company ?? comparison.documentA.name} ·{" "}
                        {comparison.documentA.period ?? "—"} vs{" "}
                        {comparison.documentB.period ?? "—"}
                      </span>
                      <div className="flex gap-2 ml-auto">
                        <Badge variant="success">
                          {comparison.metrics.filter((m) => m.direction === "up").length}{" "}
                          Improved
                        </Badge>
                        <Badge variant="destructive">
                          {comparison.metrics.filter((m) => m.direction === "down").length}{" "}
                          Declined
                        </Badge>
                      </div>
                    </div>

                    {comparison.metrics.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-12">
                        No financial metrics extracted from these documents.
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-4 mb-2 px-2">
                          <p className="text-right text-[10px] text-muted-foreground uppercase tracking-wide">
                            {comparison.documentA.period ?? "Period A"}
                          </p>
                          <p className="text-center text-[10px] text-muted-foreground uppercase tracking-wide w-[140px]">
                            Metric · Δ
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            {comparison.documentB.period ?? "Period B"}
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide w-24">
                            Magnitude
                          </p>
                        </div>

                        {comparison.metrics.map((metric, i) => (
                          <MetricRow key={metric.metricKey} metric={metric} index={i} />
                        ))}
                      </>
                    )}
                  </div>
                </TabsContent>

                {/* ── Risk tab ── */}
                <TabsContent value="risk">
                  <div className="gradient-card p-6 space-y-3">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-semibold text-sm">Risk Factor Language Changes</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {comparison.riskChanges.length === 0
                            ? "No material risk-factor changes detected"
                            : `Detected ${comparison.riskChanges.length} material change${comparison.riskChanges.length === 1 ? "" : "s"} between filings`}
                        </p>
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        {(["new", "expanded", "removed", "modified"] as const).map((type) => {
                          const cfg = riskConfig[type];
                          const count = comparison.riskChanges.filter((r) => r.type === type)
                            .length;
                          if (!count) return null;
                          return (
                            <Badge
                              key={type}
                              variant="outline"
                              className={cn("text-[10px]", cfg.color)}
                            >
                              {cfg.label}: {count}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    {comparison.riskChanges.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        Both filings appear to share the same set of risk factors.
                      </p>
                    ) : (
                      comparison.riskChanges.map((change, i) => (
                        <RiskChangeRow key={i} change={change} index={i} />
                      ))
                    )}
                  </div>
                </TabsContent>

                {/* ── Sentiment tab ── */}
                <TabsContent value="sentiment">
                  {comparison.sentiment ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="gradient-card p-6 space-y-5">
                        <div>
                          <h3 className="font-semibold text-sm mb-1">Management Tone Score</h3>
                          <p className="text-xs text-muted-foreground">
                            FinBERT positive-sentiment probability over the management
                            commentary section.
                          </p>
                        </div>
                        <SentimentGauge
                          label={`${comparison.documentA.period ?? "Period A"} Baseline`}
                          score={comparison.sentiment.scoreA}
                        />
                        <SentimentGauge
                          label={`${comparison.documentB.period ?? "Period B"} Current`}
                          score={comparison.sentiment.scoreB}
                          prev={comparison.sentiment.scoreA}
                        />
                        <div
                          className={cn(
                            "rounded-xl p-3.5 border text-sm",
                            comparison.sentiment.delta < 0
                              ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                              : "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                          )}
                        >
                          <p className="font-semibold text-xs uppercase tracking-wide mb-1">
                            AI Interpretation
                            {comparison.sentiment.significance && (
                              <span className="ml-2 opacity-80">
                                · {comparison.sentiment.significance}
                              </span>
                            )}
                          </p>
                          {comparison.sentiment.interpretation ??
                            (comparison.sentiment.delta < 0
                              ? "Management tone shifted toward increased caution between periods."
                              : "Management tone reflects increased confidence between periods.")}
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
                              <span className="text-muted-foreground">
                                A: {row.a} · B: {row.b}
                              </span>
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
                                  className={cn(
                                    "h-full rounded-full",
                                    row.b > row.a ? "bg-emerald-400/60" : "bg-red-400/60"
                                  )}
                                />
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="gradient-card p-6">
                      <p className="text-sm text-muted-foreground text-center py-8">
                        Sentiment analysis was not requested for this comparison.
                      </p>
                    </div>
                  )}
                </TabsContent>

                {/* ── Narrative tab ── */}
                <TabsContent value="narrative">
                  {comparison.narrative ? (
                    <div className="gradient-card p-6 space-y-5">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fin-400 to-fin-700 flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(34,162,105,0.3)]">
                          <Sparkles className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">AI Comparison Summary</p>
                          <p className="text-xs text-muted-foreground">
                            {IS_LIVE_API
                              ? "Generated by GPT-4o · cross-encoder re-ranked sources"
                              : "Mock narrative · enable backend for live LLM-authored summaries"}
                          </p>
                        </div>
                      </div>

                      {comparison.narrative.type === "single" ? (
                        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line border-l-2 border-fin-500/30 pl-4">
                          {comparison.narrative.body}
                        </p>
                      ) : (
                        comparison.narrative.items.map((section, i) => (
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
                        ))
                      )}

                      <div className="flex items-center gap-2 pt-2 border-t border-white/[0.07]">
                        <Info className="w-3.5 h-3.5 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">
                          Sources: {comparison.documentA.name},{" "}
                          {comparison.documentB.name}
                          {comparison.processingTimeMs !== null
                            ? ` · ${(comparison.processingTimeMs / 1000).toFixed(1)}s`
                            : ""}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="gradient-card p-6">
                      <p className="text-sm text-muted-foreground text-center py-8">
                        Narrative generation was disabled for this comparison.
                      </p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
