"use client";
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { motion } from "framer-motion";
import {
  FileText, Zap, TrendingUp, Activity, Database,
  Clock, AlertTriangle, BarChart3, PieChart as PieChartIcon,
  ArrowRight, Sparkles, Shield, RefreshCw, AlertCircle,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Header } from "@/components/layout/Header";
import { StatCard } from "@/components/dashboard/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IS_LIVE_API,
  getWorkspaceStats,
  getPipelineHealth,
  type DocumentStats,
  type PipelineHealthResponse,
  type PipelineStageStatus,
} from "@/lib/api";
import {
  mockRevenueData, mockQueryVolumeData, mockDocTypeData, mockAlerts, mockDocuments,
} from "@/lib/mock-data";
import { cn, formatNumber, relativeTime, truncate } from "@/lib/utils";
import { useWorkspaceId } from "@/lib/use-workspace";

/* ── Recharts custom tooltip ───────────────────────────────── */
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-popover/95 backdrop-blur-sm p-3 shadow-xl">
      <p className="text-xs font-semibold text-muted-foreground mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.dataKey}:</span>
          <span className="font-semibold text-foreground">{p.value}B</span>
        </div>
      ))}
    </div>
  );
}

function VolumeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-popover/95 backdrop-blur-sm p-3 shadow-xl">
      <p className="text-xs font-semibold mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground capitalize">{p.dataKey}:</span>
          <span className="font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

const CHART_COLORS = ["#22a269", "#47be85", "#7dd8ab", "#b0eacb", "#1a6645"];
const TICKER_COLORS: Record<string, string> = {
  AAPL: "#22a269",
  MSFT: "#3b82f6",
  GOOGL: "#f59e0b",
  JPM: "#8b5cf6",
};

/* ── Recent activity feed ──────────────────────────────────── */
function ActivityFeed() {
  const items = [
    { icon: FileText, color: "text-fin-400 bg-fin-500/10", text: "Apple 10-K FY2023 indexed", time: "2h ago", tag: "Indexed" },
    { icon: Sparkles, color: "text-blue-400 bg-blue-500/10", text: "Cross-document query executed", time: "3h ago", tag: "Query" },
    { icon: AlertTriangle, color: "text-amber-400 bg-amber-500/10", text: "Anomaly detected in AAPL R&D", time: "5h ago", tag: "Alert" },
    { icon: Shield, color: "text-violet-400 bg-violet-500/10", text: "PII scan passed on JPM upload", time: "1d ago", tag: "Security" },
    { icon: BarChart3, color: "text-emerald-400 bg-emerald-500/10", text: "Comparison report generated", time: "1d ago", tag: "Compare" },
  ];

  return (
    <div className="space-y-1">
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 + 0.3 }}
            className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-white/[0.03] transition-colors group cursor-pointer"
          >
            <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs", item.color)}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{item.text}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px] text-muted-foreground">{item.time}</span>
              <Badge variant="outline" className="text-[9px] py-0 px-1.5">{item.tag}</Badge>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ── RAG pipeline status ─────────────────────────────────────
 * Renders /analytics/pipeline output when live. Falls back to a
 * hard-coded "all green" mock in dev mode (IS_LIVE_API=false) so
 * the dashboard still looks alive when the backend is down.
 */
const MOCK_STAGES: PipelineStageStatus[] = [
  { stage: "PostgreSQL",   status: "ok", latency_ms: 12,   detail: null },
  { stage: "S3 Ingestion", status: "ok", latency_ms: null, detail: "0 pending" },
  { stage: "Embeddings",   status: "ok", latency_ms: 340,  detail: null },
  { stage: "Qdrant",       status: "ok", latency_ms: 8,    detail: null },
  { stage: "Groq LLM",     status: "ok", latency_ms: 1200, detail: null },
];

const STATUS_CHROME: Record<
  PipelineStageStatus["status"],
  { dot: string; ping: string; badge: "success" | "warning" | "destructive" | "secondary"; label: string }
> = {
  ok:             { dot: "bg-emerald-400", ping: "bg-emerald-400", badge: "success",     label: "Live" },
  degraded:       { dot: "bg-amber-400",   ping: "bg-amber-400",   badge: "warning",     label: "Degraded" },
  down:           { dot: "bg-red-500",     ping: "bg-red-500",     badge: "destructive", label: "Down" },
  not_configured: { dot: "bg-slate-500",   ping: "bg-slate-500",   badge: "secondary",   label: "Not set" },
  disabled:       { dot: "bg-slate-500",   ping: "bg-slate-500",   badge: "secondary",   label: "Disabled" },
};

function formatStageLatency(stage: PipelineStageStatus): string {
  if (stage.latency_ms != null) return `${Math.round(stage.latency_ms)}ms`;
  if (stage.detail) return stage.detail;
  return "—";
}

function PipelineStatus({
  stages,
  isLoading,
  isError,
}: {
  stages: PipelineStageStatus[];
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-start gap-2 py-3 px-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs">
        <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-red-300">Pipeline status unavailable</p>
          <p className="text-muted-foreground">Could not reach /analytics/pipeline.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {stages.map((stage, i) => {
        const chrome = STATUS_CHROME[stage.status] ?? STATUS_CHROME.not_configured;
        const animate = stage.status === "ok";
        return (
          <motion.div
            key={stage.stage}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.05]"
          >
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className={cn("w-2 h-2 rounded-full", chrome.dot)} />
                {animate && (
                  <div className={cn("absolute inset-0 w-2 h-2 rounded-full animate-ping opacity-40", chrome.ping)} />
                )}
              </div>
              <span className="text-xs font-medium">{stage.stage}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-mono">
                {formatStageLatency(stage)}
              </span>
              <Badge variant={chrome.badge} className="text-[9px] py-0 px-1.5">
                {chrome.label}
              </Badge>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ── Main Dashboard ────────────────────────────────────────── */
export default function DashboardPage() {
  const [revenueView, setRevenueView] = useState<"area" | "bar">("area");

  // Live workspace context (Clerk-resolved). When IS_LIVE_API is false,
  // we never even call the backend — the dashboard renders pure mocks.
  const { getToken } = useAuth();
  const workspaceId = useWorkspaceId();
  const liveEnabled = IS_LIVE_API && Boolean(workspaceId);

  const statsQuery = useQuery<DocumentStats>({
    queryKey: ["dashboard", "stats", workspaceId],
    queryFn: () => getWorkspaceStats(workspaceId!, getToken),
    enabled: liveEnabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const pipelineQuery = useQuery<PipelineHealthResponse>({
    queryKey: ["dashboard", "pipeline"],
    queryFn: () => getPipelineHealth(getToken),
    enabled: IS_LIVE_API,                   // pipeline health doesn't need a workspace
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Mock fallbacks when live mode is off, the request errors, or a workspace
  // hasn't been picked yet. Each card still has a sensible value.
  const indexedDocs = statsQuery.data
    ? statsQuery.data.indexed
    : mockDocuments.filter((d) => d.status === "indexed").length;
  const totalDocs = statsQuery.data?.total_documents ?? null;
  const totalQueries = statsQuery.data ? statsQuery.data.total_queries : 1307;
  const totalChunks = statsQuery.data ? statsQuery.data.total_chunks : null;
  const failedDocs = statsQuery.data ? statsQuery.data.failed : null;
  const activeAlerts = mockAlerts.filter((a) => !a.read).length;

  const stagesForRender: PipelineStageStatus[] = pipelineQuery.data?.stages?.length
    ? pipelineQuery.data.stages
    : MOCK_STAGES;

  // Pipeline header subtitle reflects the overall health when live.
  const pipelineSubtitle = (() => {
    if (!IS_LIVE_API) return "All systems operational";
    if (pipelineQuery.isLoading) return "Checking…";
    if (pipelineQuery.isError) return "Status unavailable";
    switch (pipelineQuery.data?.overall) {
      case "ok":       return "All systems operational";
      case "degraded": return "Some services degraded";
      case "down":     return "One or more services down";
      default:         return "Status unknown";
    }
  })();

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Dashboard"
        subtitle="Portfolio intelligence overview"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Documents Indexed"
            value={statsQuery.isLoading ? "…" : formatNumber(indexedDocs)}
            unit={totalDocs != null ? `of ${formatNumber(totalDocs)}` : "files"}
            change={12.5}
            changeLabel="vs last week"
            icon={Database}
            index={0}
          />
          <StatCard
            title={statsQuery.data ? "Total Queries" : "Queries Today"}
            value={statsQuery.isLoading ? "…" : formatNumber(totalQueries)}
            change={18.3}
            changeLabel={statsQuery.data ? "lifetime" : "vs yesterday"}
            icon={Zap}
            iconColor="text-blue-400"
            iconBg="bg-blue-500/10"
            index={1}
          />
          <StatCard
            title={statsQuery.data ? "Total Chunks" : "Avg Confidence"}
            value={
              statsQuery.isLoading
                ? "…"
                : statsQuery.data
                  ? formatNumber(totalChunks ?? 0)
                  : "94.2"
            }
            unit={statsQuery.data ? "chunks" : "%"}
            change={1.8}
            changeLabel="vs last week"
            icon={TrendingUp}
            iconColor="text-emerald-400"
            iconBg="bg-emerald-500/10"
            index={2}
          />
          <StatCard
            title={statsQuery.data ? "Failed Documents" : "Active Alerts"}
            value={
              statsQuery.isLoading
                ? "…"
                : statsQuery.data
                  ? formatNumber(failedDocs ?? 0)
                  : activeAlerts
            }
            change={-25}
            changeLabel="resolved"
            icon={AlertTriangle}
            iconColor="text-amber-400"
            iconBg="bg-amber-500/10"
            index={3}
          />
        </div>

        {/* ── Charts row 1 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Revenue chart (2/3 width) */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="lg:col-span-2 gradient-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Quarterly Revenue Comparison</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Cross-portfolio · Billions USD</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setRevenueView("area")}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                    revenueView === "area"
                      ? "bg-fin-500/20 text-fin-300"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Area
                </button>
                <button
                  onClick={() => setRevenueView("bar")}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                    revenueView === "bar"
                      ? "bg-fin-500/20 text-fin-300"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Bar
                </button>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={220}>
              {revenueView === "area" ? (
                <AreaChart data={mockRevenueData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                  <defs>
                    {Object.entries(TICKER_COLORS).map(([ticker, color]) => (
                      <linearGradient key={ticker} id={`grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  {Object.entries(TICKER_COLORS).map(([ticker, color]) => (
                    <Area
                      key={ticker}
                      type="monotone"
                      dataKey={ticker}
                      stroke={color}
                      strokeWidth={2}
                      fill={`url(#grad-${ticker})`}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  ))}
                </AreaChart>
              ) : (
                <BarChart data={mockRevenueData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  {Object.entries(TICKER_COLORS).map(([ticker, color]) => (
                    <Bar key={ticker} dataKey={ticker} fill={color} radius={[2, 2, 0, 0]} opacity={0.85} />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </motion.div>

          {/* Doc type pie (1/3) */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="gradient-card p-5"
          >
            <h3 className="text-sm font-semibold mb-0.5">Document Types</h3>
            <p className="text-xs text-muted-foreground mb-4">Corpus breakdown</p>

            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie
                  data={mockDocTypeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={3}
                  dataKey="value"
                  animationBegin={200}
                  animationDuration={800}
                >
                  {mockDocTypeData.map((entry, i) => (
                    <Cell key={entry.name} fill={entry.color} strokeWidth={0} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [`${value}%`, ""]}
                  contentStyle={{
                    background: "hsl(222 47% 7%)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            <div className="space-y-1.5 mt-2">
              {mockDocTypeData.map((item) => (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="font-medium">{item.value}%</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* ── Charts row 2 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Query volume chart */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="lg:col-span-2 gradient-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Query Volume — This Week</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Successful vs failed queries</p>
              </div>
              <Badge variant="success" className="text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5" />
                98.1% success rate
              </Badge>
            </div>

            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={mockQueryVolumeData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip content={<VolumeTooltip />} />
                <Bar dataKey="successful" stackId="a" fill="#22a269" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failed" stackId="a" fill="#ef4444" opacity={0.7} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Pipeline status */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="gradient-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">RAG Pipeline</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{pipelineSubtitle}</p>
              </div>
              <button
                onClick={() => pipelineQuery.refetch()}
                disabled={!IS_LIVE_API || pipelineQuery.isFetching}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                aria-label="Refresh pipeline status"
              >
                <RefreshCw
                  className={cn(
                    "w-3.5 h-3.5",
                    pipelineQuery.isFetching && "animate-spin"
                  )}
                />
              </button>
            </div>
            <PipelineStatus
              stages={stagesForRender}
              isLoading={IS_LIVE_API && pipelineQuery.isLoading}
              isError={IS_LIVE_API && pipelineQuery.isError}
            />
          </motion.div>
        </div>

        {/* ── Bottom row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pb-6">

          {/* Recent activity */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="gradient-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Recent Activity</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Workspace events</p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs gap-1 h-7">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
            <ActivityFeed />
          </motion.div>

          {/* Top documents */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            className="gradient-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Most Queried Documents</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Last 7 days</p>
              </div>
            </div>
            <div className="space-y-3">
              {[
                { name: "Apple_10K_2023.pdf", ticker: "AAPL", queries: 312, pct: 92 },
                { name: "MSFT_EarningsQ4_2023.pdf", ticker: "MSFT", queries: 228, pct: 68 },
                { name: "JPM_AnnualReport_2023.pdf", ticker: "JPM", queries: 187, pct: 55 },
                { name: "Google_Prospectus_2024.pdf", ticker: "GOOGL", queries: 143, pct: 42 },
              ].map((doc, i) => (
                <motion.div
                  key={doc.name}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.07 }}
                  className="space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-fin-300 flex-shrink-0">{doc.ticker}</span>
                      <span className="text-muted-foreground truncate">{doc.name}</span>
                    </div>
                    <span className="font-medium flex-shrink-0 ml-2">{doc.queries}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${doc.pct}%` }}
                      transition={{ duration: 0.8, delay: 0.65 + i * 0.07 }}
                      className="h-full rounded-full bg-gradient-to-r from-fin-600 to-fin-400"
                    />
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Compliance badge */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              className="mt-5 flex items-center gap-2.5 p-3 rounded-xl bg-fin-500/10 border border-fin-500/20"
            >
              <Shield className="w-4 h-4 text-fin-400 flex-shrink-0" />
              <div className="text-xs">
                <p className="font-semibold text-fin-300">All queries logged</p>
                <p className="text-muted-foreground">7-year DynamoDB audit trail · SEC Rule 17a-4</p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
