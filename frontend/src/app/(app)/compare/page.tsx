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
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, Minus, ArrowRight, Sparkles,
  ChevronDown, FileText, RefreshCw, Download, Info,
  AlertTriangle, PlusCircle, MinusCircle, Edit3, AlertCircle,
  History, Loader2, CheckCircle2, XCircle,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  IS_LIVE_API,
  ApiError,
  createComparison,
  getComparison,
  listComparisons,
  pollComparison,
  type ComparisonListItem,
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
import { useWorkspaceId } from "@/lib/use-workspace";
import { useTranslation } from "@/lib/i18n";

/* ── Selector dropdown — now backed by the document store ──────────────── */
interface DocSelectorProps {
  label: string;
  selected: Document | null;
  options: Document[];
  onChange: (doc: Document) => void;
  excludeId?: string;
}

function DocSelector({ label, selected, options, onChange, excludeId }: DocSelectorProps) {
  const { t } = useTranslation();
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
            <p className="text-sm text-muted-foreground italic">{t("compare.selectDocument")}</p>
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
                {t("compare.noOtherDocs")}
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
  const { t } = useTranslation();
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
        <p className="text-[10px] text-muted-foreground">{t("compare.periodA")}</p>
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
        <p className="text-[10px] text-muted-foreground">{t("compare.periodB")}</p>
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
    labelKey: "risk.new",
  },
  expanded: {
    icon: Edit3,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    labelKey: "risk.expanded",
  },
  removed: {
    icon: MinusCircle,
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    labelKey: "risk.removed",
  },
  modified: {
    icon: AlertTriangle,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    labelKey: "risk.modified",
  },
} as const;

function RiskChangeRow({ change, index }: { change: NormalisedRiskChange; index: number }) {
  const { t } = useTranslation();
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
          {t(cfg.labelKey)}
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
  "compare.stepLive1",
  "compare.stepLive2",
  "compare.stepLive3",
  "compare.stepLive4",
  "compare.stepLive5",
  "compare.stepLive6",
];

const PROGRESS_STEPS_MOCK = [
  "compare.stepMock1",
  "compare.stepMock2",
  "compare.stepMock3",
  "compare.stepMock4",
  "compare.stepMock5",
];

/* ── Main page ─────────────────────────────────────────────────────────── */
export default function ComparePage() {
  const { t } = useTranslation();
  const documents = useAppStore((s) => s.documents);
  const workspaceId = useWorkspaceId();
  const { getToken } = useAuth();
  const liveEnabled = IS_LIVE_API && !!workspaceId;

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

  // No preexisting/sample comparison is shown. The results area stays empty
  // until the user runs a real comparison against their own documents.

  const runComparison = async () => {
    if (!docA || !docB) return;
    if (docA.id === docB.id) {
      setRunError(t("compare.pickTwoDifferent"));
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
        setRunError(final.error_message ?? t("compare.comparisonFailed"));
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

  /* ── Comparison history (GET /comparisons) ──────────────────────────── */
  const historyQuery = useQuery<ComparisonListItem[]>({
    queryKey: ["comparisons", workspaceId],
    queryFn: () =>
      listComparisons({ workspace_id: workspaceId!, limit: 20 }, getToken),
    enabled: liveEnabled,
    staleTime: 30_000,
    // Poll while there's an in-flight comparison so the row flips from
    // processing → completed without a manual refresh.
    refetchInterval: (q) => {
      const items = q.state.data;
      const hasProcessing = items?.some((c) => c.status === "processing");
      return hasProcessing ? 5_000 : false;
    },
  });

  /**
   * Load a previously-run comparison from history. If it's still
   * processing we poll until it completes; otherwise we hit the cache-
   * friendly GET and adapt it for the existing results UI.
   */
  const loadComparisonById = async (item: ComparisonListItem) => {
    setRunError(null);
    setIsRunning(true);

    // Best-effort: rehydrate the doc selectors from the local store so the
    // header chips stay in sync. The store may have evicted them since
    // (e.g. another workspace), in which case we leave the selector blank.
    const fromStore = (id: string) =>
      documents.find((d) => d.id === id) ?? null;
    const a = fromStore(item.document_a_id);
    const b = fromStore(item.document_b_id);
    if (a) setDocA(a);
    if (b) setDocB(b);

    try {
      let result =
        item.status === "processing"
          ? await pollComparison(item.id, { getToken })
          : await getComparison(item.id, getToken);

      if (result.status === "failed") {
        setRunError(result.error_message ?? t("compare.comparisonFailed"));
      }
      setComparison(adaptLiveComparison(result));
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
        title={t("compare.title")}
        subtitle={t("compare.subtitle")}
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
              label={t("compare.documentABaseline")}
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
              label={t("compare.documentBCompare")}
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
                  {t("compare.analyzing")}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {t("compare.runComparison")}
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
                {t("compare.demoHint")}
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
                        {t(step)}
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Comparison history rail ──────────────────────────────────── */}
        <RecentComparisons
          query={historyQuery}
          documents={documents}
          onSelect={loadComparisonById}
          activeId={null}
          liveEnabled={liveEnabled}
        />

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
                    {t("compare.financialMetrics", { count: comparison.metrics.length })}
                  </TabsTrigger>
                  <TabsTrigger value="risk">
                    {t("compare.riskFactorChanges", { count: comparison.riskChanges.length })}
                  </TabsTrigger>
                  <TabsTrigger value="sentiment" disabled={!comparison.sentiment}>
                    {t("compare.sentimentAnalysis")}
                  </TabsTrigger>
                  <TabsTrigger value="narrative" disabled={!comparison.narrative}>
                    {t("compare.aiNarrative")}
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
                          {t("compare.improved")}
                        </Badge>
                        <Badge variant="destructive">
                          {comparison.metrics.filter((m) => m.direction === "down").length}{" "}
                          {t("compare.declined")}
                        </Badge>
                      </div>
                    </div>

                    {comparison.metrics.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-12">
                        {t("compare.noMetrics")}
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-4 mb-2 px-2">
                          <p className="text-right text-[10px] text-muted-foreground uppercase tracking-wide">
                            {comparison.documentA.period ?? t("compare.periodA")}
                          </p>
                          <p className="text-center text-[10px] text-muted-foreground uppercase tracking-wide w-[140px]">
                            {t("compare.metricDelta")}
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            {comparison.documentB.period ?? t("compare.periodB")}
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide w-24">
                            {t("compare.magnitude")}
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
                        <h3 className="font-semibold text-sm">{t("compare.riskLanguageChanges")}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {comparison.riskChanges.length === 0
                            ? t("compare.noRiskChanges")
                            : comparison.riskChanges.length === 1
                              ? t("compare.detectedChangesOne", { count: comparison.riskChanges.length })
                              : t("compare.detectedChangesOther", { count: comparison.riskChanges.length })}
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
                              {t(cfg.labelKey)}: {count}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    {comparison.riskChanges.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        {t("compare.sameRiskFactors")}
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
                          <h3 className="font-semibold text-sm mb-1">{t("compare.managementToneScore")}</h3>
                          <p className="text-xs text-muted-foreground">
                            {t("compare.managementToneDesc")}
                          </p>
                        </div>
                        <SentimentGauge
                          label={t("compare.baseline", { period: comparison.documentA.period ?? t("compare.periodA") })}
                          score={comparison.sentiment.scoreA}
                        />
                        <SentimentGauge
                          label={t("compare.current", { period: comparison.documentB.period ?? t("compare.periodB") })}
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
                            {t("compare.aiInterpretation")}
                            {comparison.sentiment.significance && (
                              <span className="ml-2 opacity-80">
                                · {comparison.sentiment.significance}
                              </span>
                            )}
                          </p>
                          {comparison.sentiment.interpretation ??
                            (comparison.sentiment.delta < 0
                              ? t("compare.toneCaution")
                              : t("compare.toneConfidence"))}
                        </div>
                      </div>

                      <div className="gradient-card p-6 space-y-4">
                        <h3 className="font-semibold text-sm">{t("compare.linguisticBreakdown")}</h3>
                        {[
                          { label: t("compare.confidenceLanguage"), a: 72, b: 58 },
                          { label: t("compare.hedgingPhrases"), a: 28, b: 45 },
                          { label: t("compare.forwardGuidance"), a: 64, b: 61 },
                          { label: t("compare.riskAcknowledgement"), a: 41, b: 53 },
                          { label: t("compare.positiveOutlook"), a: 69, b: 55 },
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
                        {t("compare.sentimentNotRequested")}
                      </p>
                    </div>
                  )}
                </TabsContent>

                {/* ── Narrative tab ── */}
                <TabsContent value="narrative">
                  {comparison.narrative ? (
                    <div className="gradient-card p-6 space-y-5">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fin-400 to-fin-700 flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(245,166,35,0.3)]">
                          <Sparkles className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{t("compare.aiSummary")}</p>
                          <p className="text-xs text-muted-foreground">
                            {IS_LIVE_API
                              ? t("compare.narrativeLive")
                              : t("compare.narrativeMock")}
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
                          {t("compare.sources")}: {comparison.documentA.name},{" "}
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
                        {t("compare.narrativeDisabled")}
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



/* ─────────────────────────────────────────────────────────────────────────────
 * RecentComparisons — wires GET /api/v1/comparisons.
 *
 * Horizontal-scroll rail of the most recent 20 comparisons in the active
 * workspace. Each chip links into the live result (re-using the existing
 * results UI by feeding `getComparison` → `adaptLiveComparison`).
 *
 * In mock mode (or when no backend URL is set) the rail collapses into a
 * one-line placeholder rather than disappearing entirely so analysts know
 * the surface exists.
 * ────────────────────────────────────────────────────────────────────────── */

const STATUS_CHROME: Record<
  string,
  { icon: React.ElementType; classes: string; labelKey: string }
> = {
  completed:  { icon: CheckCircle2, classes: "text-emerald-300 bg-emerald-500/10", labelKey: "compare.statusDone" },
  processing: { icon: Loader2,      classes: "text-violet-300 bg-violet-500/10",   labelKey: "compare.statusRunning" },
  failed:     { icon: XCircle,      classes: "text-red-300 bg-red-500/10",         labelKey: "compare.statusFailed" },
};

function statusChrome(status: string) {
  return STATUS_CHROME[status] ?? STATUS_CHROME.completed;
}

function RecentComparisons({
  query,
  documents,
  onSelect,
  activeId,
  liveEnabled,
}: {
  query: UseQueryResult<ComparisonListItem[], Error>;
  documents: Document[];
  onSelect: (item: ComparisonListItem) => void;
  activeId: string | null;
  liveEnabled: boolean;
}) {
  const { t } = useTranslation();
  const docMap = useMemo(() => {
    const map = new Map<string, Document>();
    documents.forEach((d) => map.set(d.id, d));
    return map;
  }, [documents]);

  if (!liveEnabled) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
        <History className="w-3.5 h-3.5 text-fin-400" />
        {t("compare.connectBackendHistoryPrefix")} <code className="text-fin-300">NEXT_PUBLIC_API_URL</code> {t("compare.connectBackendHistorySuffix")}
      </div>
    );
  }

  const items = query.data ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="gradient-card p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History className="w-3.5 h-3.5 text-fin-400" />
          <span className="text-sm font-semibold">{t("compare.recentComparisons")}</span>
          {query.data && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5">
              {query.data.length}
            </Badge>
          )}
        </div>
        <button
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          aria-label={t("compare.refreshHistory")}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", query.isFetching && "animate-spin")} />
        </button>
      </div>

      {query.isLoading && (
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-56 rounded-lg flex-shrink-0" />
          ))}
        </div>
      )}

      {query.isError && (
        <div className="flex items-start gap-2 py-2 px-3 rounded-md bg-red-500/5 border border-red-500/20 text-xs">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <span className="text-red-300">
            {(query.error as Error)?.message ?? t("compare.couldNotLoadHistory")}
          </span>
        </div>
      )}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <p className="text-xs text-muted-foreground py-3 text-center">
          {t("compare.noComparisonsYet")}
        </p>
      )}

      {items.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {items.map((item) => (
            <ComparisonChip
              key={item.id}
              item={item}
              docA={docMap.get(item.document_a_id) ?? null}
              docB={docMap.get(item.document_b_id) ?? null}
              active={item.id === activeId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function ComparisonChip({
  item,
  docA,
  docB,
  active,
  onSelect,
}: {
  item: ComparisonListItem;
  docA: Document | null;
  docB: Document | null;
  active: boolean;
  onSelect: (item: ComparisonListItem) => void;
}) {
  const { t } = useTranslation();
  const chrome = statusChrome(item.status);
  const StatusIcon = chrome.icon;
  const labelA = docA?.ticker ?? docA?.name ?? item.document_a_id.slice(0, 8);
  const labelB = docB?.ticker ?? docB?.name ?? item.document_b_id.slice(0, 8);

  return (
    <button
      onClick={() => onSelect(item)}
      className={cn(
        "flex-shrink-0 w-60 text-left rounded-lg border px-3 py-2.5 transition-all",
        active
          ? "border-fin-500/40 bg-fin-500/10"
          : "border-white/[0.07] bg-white/[0.02] hover:border-fin-500/30 hover:bg-fin-500/5",
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
            chrome.classes,
          )}
        >
          <StatusIcon
            className={cn("w-3 h-3", item.status === "processing" && "animate-spin")}
          />
          {t(chrome.labelKey)}
        </span>
        {item.overall_sentiment_shift && item.overall_sentiment_shift !== "stable" && (
          <Badge
            variant="outline"
            className={cn(
              "text-[9px] py-0 px-1.5",
              item.overall_sentiment_shift === "positive"
                ? "text-emerald-300 border-emerald-500/30"
                : "text-red-300 border-red-500/30",
            )}
          >
            {item.overall_sentiment_shift}
          </Badge>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {new Date(item.created_at).toLocaleDateString()}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-xs font-medium truncate">
        <span className="truncate">{labelA}</span>
        <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        <span className="truncate">{labelB}</span>
      </div>

      <p className="text-[10px] text-muted-foreground mt-1">
        {t("compare.significant", { changed: item.metrics_with_significant_changes, total: item.total_metrics_compared })}
        {item.processing_time_ms != null && (
          <span> · {(item.processing_time_ms / 1000).toFixed(1)}s</span>
        )}
      </p>
    </button>
  );
}
