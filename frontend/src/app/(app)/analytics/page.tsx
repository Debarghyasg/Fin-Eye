"use client";
/**
 * Analytics page — Phase 4 Week 8 Day 4-5.
 *
 * Dedicated deep-dive on workspace activity. Five chart blocks:
 *   1. Query volume over time (30-day stacked area: successful + failed)
 *   2. Average confidence trend (line + shaded p25/p75 band)
 *   3. Token usage per day (stacked bar: prompt + completion)
 *   4. Query types (donut)
 *   5. Most queried documents (horizontal bar)
 *
 * Top-row stat cards show the live aggregates from the Phase 3
 * /api/v1/analytics/audit/workspace/{id} endpoint when IS_LIVE_API is
 * true, otherwise summed from the mock series so the demo page is never
 * empty. Per-day series are still mock-only because the backend
 * aggregates endpoint doesn't yet bucket-by-day — flagged inline so a
 * reader knows what's live and what's not.
 */
import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Zap, TrendingUp, Activity, Coins, FileText, BarChart3,
  AlertCircle,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

import { Header } from "@/components/layout/Header";
import { StatCard } from "@/components/dashboard/StatCard";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IS_LIVE_API,
  getWorkspaceAuditAnalytics,
  type WorkspaceAnalytics,
} from "@/lib/api";
import {
  mockConfidenceTrend,
  mockModelMix,
  mockMostQueriedDocs,
  mockQueryTypes,
  mockQueryVolumeTrend,
  mockTokenUsage,
} from "@/lib/mock-data";
import { cn, formatNumber } from "@/lib/utils";
import { useWorkspaceId } from "@/lib/use-workspace";

/* ── Chart tooltips ───────────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label, suffix = "" }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-popover/95 backdrop-blur-sm p-3 shadow-xl text-xs">
      <p className="font-semibold text-muted-foreground mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground capitalize">
            {String(p.dataKey).replace(/_/g, " ")}:
          </span>
          <span className="font-semibold text-foreground">
            {typeof p.value === "number" ? p.value.toLocaleString() : p.value}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function AnalyticsPage() {
  // Resolve the real workspace UUID. Live calls are gated on this so we
  // never hit the backend with the literal string "default".
  const workspaceId = useWorkspaceId();

  // Live audit aggregates — only fired when an API URL is configured
  // AND we have a real workspace_id resolved.
  const { data: live, isLoading: liveLoading, error: liveError } = useQuery<WorkspaceAnalytics>({
    queryKey: ["audit-analytics", workspaceId, 30],
    queryFn: () => getWorkspaceAuditAnalytics(workspaceId!, 30),
    enabled: IS_LIVE_API && !!workspaceId,
    staleTime: 5 * 60_000,
  });

  // Aggregates: live values when available, else summed from the mock series.
  const aggregates = useMemo(() => {
    const dyn = live?.analytics?.dynamodb;
    const pg = live?.analytics?.postgres;

    const totalQueriesMock = mockQueryVolumeTrend.reduce((s, d) => s + d.queries, 0);
    const totalTokensMock = mockTokenUsage.reduce((s, d) => s + d.total, 0);
    const avgConfMock =
      mockConfidenceTrend.reduce((s, d) => s + d.avg_confidence, 0) /
      mockConfidenceTrend.length;

    return {
      totalQueries:
        dyn?.total_queries ?? pg?.total_queries ?? totalQueriesMock,
      avgConfidence:
        dyn?.avg_confidence ?? pg?.avg_confidence ?? avgConfMock,
      totalTokens: dyn?.total_tokens ?? totalTokensMock,
      avgLatencyMs: dyn?.avg_latency_ms ?? null,
      modelDistribution:
        dyn?.model_distribution ?? pg?.model_distribution ?? null,
    };
  }, [live]);

  // Model distribution donut — derive from live data if present
  const modelMixData = useMemo(() => {
    const palette = ["#22a269", "#47be85", "#7dd8ab", "#3b82f6", "#f59e0b", "#94a3b8"];
    if (aggregates.modelDistribution) {
      const total =
        Object.values(aggregates.modelDistribution).reduce((a, b) => a + b, 0) || 1;
      return Object.entries(aggregates.modelDistribution).map(([name, value], i) => ({
        name,
        value: Math.round((value / total) * 100),
        color: palette[i % palette.length],
      }));
    }
    return mockModelMix;
  }, [aggregates.modelDistribution]);

  // Estimated cost — at GPT-4o blended ~ $0.000015/token
  const estimatedCostUsd = (aggregates.totalTokens * 0.000015).toFixed(2);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Analytics"
        subtitle="30-day workspace activity · query volume, confidence, token usage"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* ── Data-source banner ───────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "flex items-center gap-3 rounded-xl border px-4 py-2.5",
            IS_LIVE_API
              ? "bg-emerald-500/5 border-emerald-500/20"
              : "bg-amber-500/5 border-amber-500/20"
          )}
        >
          <div
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
              IS_LIVE_API ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
            )}
          >
            {IS_LIVE_API ? <BarChart3 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          </div>
          <div className="flex-1 text-xs">
            {IS_LIVE_API ? (
              liveError ? (
                <span className="text-red-300">
                  Backend reachable but the audit endpoint returned an error:{" "}
                  <span className="font-mono">{(liveError as Error).message}</span>
                </span>
              ) : liveLoading ? (
                <span className="text-emerald-300">
                  Live · loading aggregates from /analytics/audit/workspace/{workspaceId ?? "…"}…
                </span>
              ) : (
                <span className="text-emerald-300">
                  Live · aggregate stats from /analytics/audit/workspace/{workspaceId ?? "?"} (period: {live?.period_days ?? 30}d).
                  Per-day time series remain mock until the analytics endpoint
                  buckets by day.
                </span>
              )
            ) : (
              <span className="text-amber-300">
                Demo mode — set NEXT_PUBLIC_API_URL to wire the top-row stat cards
                and model-distribution donut to live data from
                /api/v1/analytics/audit/workspace/&lt;id&gt;.
              </span>
            )}
          </div>
        </motion.div>

        {/* ── Top stats ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {liveLoading ? (
            <>
              <Skeleton className="h-[112px]" />
              <Skeleton className="h-[112px]" />
              <Skeleton className="h-[112px]" />
              <Skeleton className="h-[112px]" />
            </>
          ) : (
            <>
              <StatCard
                title="Total Queries"
                value={formatNumber(aggregates.totalQueries)}
                change={18.4}
                changeLabel="vs prior 30d"
                icon={Zap}
                iconColor="text-blue-400"
                iconBg="bg-blue-500/10"
                index={0}
              />
              <StatCard
                title="Avg Confidence"
                value={(aggregates.avgConfidence * 100).toFixed(1)}
                unit="%"
                change={2.1}
                changeLabel="vs prior 30d"
                icon={TrendingUp}
                iconColor="text-emerald-400"
                iconBg="bg-emerald-500/10"
                index={1}
              />
              <StatCard
                title="Tokens Consumed"
                value={formatNumber(aggregates.totalTokens)}
                change={-4.7}
                changeLabel="vs prior 30d"
                icon={Coins}
                iconColor="text-fin-400"
                iconBg="bg-fin-500/10"
                index={2}
              />
              <StatCard
                title="Estimated Cost"
                value={`$${estimatedCostUsd}`}
                change={-4.7}
                changeLabel="GPT-4o blended"
                icon={Activity}
                iconColor="text-violet-400"
                iconBg="bg-violet-500/10"
                index={3}
              />
            </>
          )}
        </div>

        {/* ── Row 1: query volume + confidence ─────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Query volume over time */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="gradient-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Query Volume</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last 30 days · successful vs failed
                </p>
              </div>
              <Badge variant="success" className="text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5" />
                {(
                  (mockQueryVolumeTrend.reduce((s, d) => s + d.successful, 0) /
                    Math.max(
                      1,
                      mockQueryVolumeTrend.reduce((s, d) => s + d.queries, 0)
                    )) *
                  100
                ).toFixed(1)}
                % success
              </Badge>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={mockQueryVolumeTrend} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} interval={4} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="successful" stackId="q" fill="#22a269" />
                <Bar dataKey="failed" stackId="q" fill="#ef4444" opacity={0.7} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.section>

          {/* Confidence trend */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="gradient-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Confidence Trend</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Daily mean with p25/p75 band
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] text-emerald-300 border-emerald-500/30">
                Trend ↑ +2.1%
              </Badge>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={mockConfidenceTrend} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} interval={4} />
                <YAxis
                  domain={[0.6, 1.0]}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (v * 100).toFixed(0) + "%"}
                />
                <Tooltip content={<ChartTooltip />} />
                {/* p25/p75 band rendered as two areas with the same fill but
                    different baselines — Recharts doesn't have a native band
                    so we approximate with stroke-only line on the upper bound
                    and a filled area on the lower bound. */}
                <Line
                  type="monotone"
                  dataKey="p75"
                  stroke="rgba(34,162,105,0.15)"
                  strokeWidth={1}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="p25"
                  stroke="rgba(34,162,105,0.15)"
                  strokeWidth={1}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="avg_confidence"
                  stroke="#22a269"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </motion.section>
        </div>

        {/* ── Row 2: token usage + query types ─────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Token usage per day */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="lg:col-span-2 gradient-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Token Usage Per Day</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Prompt + completion tokens · 30 days
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground">
                Total: {formatNumber(mockTokenUsage.reduce((s, d) => s + d.total, 0))}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={mockTokenUsage} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="tok-prompt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.85} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="tok-completion" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22a269" stopOpacity={0.85} />
                    <stop offset="100%" stopColor="#22a269" stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} interval={4} />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatNumber(v)}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="prompt_tokens" stackId="t" fill="url(#tok-prompt)" />
                <Bar dataKey="completion_tokens" stackId="t" fill="url(#tok-completion)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.section>

          {/* Query types donut */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="gradient-card p-5"
          >
            <h3 className="text-sm font-semibold mb-0.5">Query Types</h3>
            <p className="text-xs text-muted-foreground mb-4">Topic distribution</p>
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie
                  data={mockQueryTypes}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                  animationBegin={150}
                  animationDuration={700}
                >
                  {mockQueryTypes.map((entry) => (
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
              {mockQueryTypes.map((entry) => (
                <div key={entry.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: entry.color }}
                    />
                    <span className="text-muted-foreground">{entry.name}</span>
                  </div>
                  <span className="font-medium">{entry.value}%</span>
                </div>
              ))}
            </div>
          </motion.section>
        </div>

        {/* ── Row 3: most queried docs + model mix ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-6">
          {/* Most queried documents — horizontal bar */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="lg:col-span-2 gradient-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Most Queried Documents</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last 30 days · cross-doc query usage
                </p>
              </div>
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            </div>

            <div className="space-y-3">
              {mockMostQueriedDocs.map((doc, i) => {
                const max = Math.max(...mockMostQueriedDocs.map((d) => d.queries));
                const pct = (doc.queries / max) * 100;
                return (
                  <motion.div
                    key={doc.id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.45 + i * 0.05 }}
                    className="space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-fin-300 flex-shrink-0">
                          {doc.ticker}
                        </span>
                        <span className="text-muted-foreground truncate">{doc.name}</span>
                      </div>
                      <span className="font-mono text-foreground flex-shrink-0 ml-2">
                        {doc.queries} queries
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, delay: 0.5 + i * 0.06 }}
                        className="h-full rounded-full bg-gradient-to-r from-fin-600 to-fin-400"
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.section>

          {/* Model mix donut */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="gradient-card p-5"
          >
            <h3 className="text-sm font-semibold mb-0.5">Model Mix</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {aggregates.modelDistribution
                ? "Live distribution from query_logs"
                : "Demo distribution"}
            </p>
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie
                  data={modelMixData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {modelMixData.map((entry) => (
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
              {modelMixData.map((entry) => (
                <div key={entry.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: entry.color }}
                    />
                    <span className="text-muted-foreground truncate" title={entry.name}>
                      {entry.name}
                    </span>
                  </div>
                  <span className="font-medium flex-shrink-0">{entry.value}%</span>
                </div>
              ))}
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  );
}
