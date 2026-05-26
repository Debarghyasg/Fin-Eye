"use client";
/**
 * Alerts page — Phase 4 Week 8 Day 6-7 (re-wired).
 *
 * Two big behaviour changes from Phase 3's mock-only version:
 *
 *   1. The "Add Ticker" placeholder is now a real <SubscribeTickerDialog>
 *      that POSTs to /api/v1/alerts/subscriptions when IS_LIVE_API,
 *      otherwise appends to a local mock list. Success path shows a
 *      "Now monitoring EDGAR for AAPL…" confirmation.
 *
 *   2. When IS_LIVE_API:
 *        - Alert feed pulls from /api/v1/alerts (30s polling via React Query)
 *        - Mark-read calls PATCH /alerts/{id}/read with optimistic update
 *        - Mark-all-read calls POST /alerts/read-all
 *        - Subscriptions list pulls from /api/v1/alerts/subscriptions
 *      Otherwise the page stays on the existing in-memory mock store
 *      (useAppStore.alerts, mockSubscriptions) so the demo experience
 *      is preserved.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, AlertTriangle, Bell, BellOff, Check, ChevronRight,
  Eye, FileText, Plus, Shield, TrendingDown, X, Zap, Loader2,
  RefreshCw,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SubscribeTickerDialog } from "@/components/workspace/SubscribeTickerDialog";
import {
  IS_LIVE_API,
  ApiError,
  deleteSubscription,
  listAlerts,
  listSubscriptions,
  markAlertRead as apiMarkRead,
  markAllAlertsRead as apiMarkAllRead,
  triggerEdgarPoll,
  updateSubscription,
  type AlertOut,
  type AlertListResponse,
  type AlertSeverity,
  type AlertType,
  type TickerSubscription,
} from "@/lib/api";
import { mockAlerts, mockSubscriptions } from "@/lib/mock-data";
import { cn, relativeTime } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

const DEFAULT_WORKSPACE_ID =
  process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_ID ?? "default";

/* ── Visual config ─────────────────────────────────────────────────────── */
const alertConfig: Record<
  AlertType,
  { icon: React.ElementType; color: string; bg: string }
> = {
  anomaly: {
    icon: Activity,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  sentiment: {
    icon: TrendingDown,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
  },
  regulatory: {
    icon: Shield,
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
  },
  filing: {
    icon: FileText,
    color: "text-fin-400",
    bg: "bg-fin-500/10 border-fin-500/20",
  },
};

const severityConfig: Record<
  AlertSeverity,
  { label: string; variant: "default" | "destructive" | "warning" | "secondary"; dot: string }
> = {
  high: { label: "High", variant: "destructive", dot: "bg-red-400" },
  medium: { label: "Medium", variant: "warning", dot: "bg-amber-400" },
  low: { label: "Low", variant: "default", dot: "bg-fin-400" },
  info: { label: "Info", variant: "secondary", dot: "bg-muted-foreground" },
};

/* ── Normalised alert (works for both shapes) ──────────────────────────── */
type NormAlert = {
  id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  ticker: string | null;
  company: string | null;
  read: boolean;
  createdAt: Date;
  /** Optional doc-level click target — for live alerts it's document_id;
   *  for mock alerts it's docId. Used to navigate users to the source. */
  documentId: string | null;
};

function normaliseLive(a: AlertOut, companyByTicker: Map<string, string>): NormAlert {
  return {
    id: a.id,
    alert_type: a.alert_type,
    severity: a.severity,
    title: a.title,
    description: a.description,
    ticker: a.ticker,
    company: a.ticker ? companyByTicker.get(a.ticker) ?? null : null,
    read: a.read,
    createdAt: new Date(a.created_at),
    documentId: a.document_id,
  };
}

function normaliseMock(a: typeof mockAlerts[number]): NormAlert {
  return {
    id: a.id,
    alert_type: a.type,
    severity: a.severity,
    title: a.title,
    description: a.description,
    ticker: a.ticker,
    company: a.company,
    read: a.read,
    createdAt: a.timestamp,
    documentId: a.docId,
  };
}

/* ── Single Alert Card ─────────────────────────────────────────────────── */
function AlertCard({
  alert,
  onRead,
}: {
  alert: NormAlert;
  onRead: (id: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const cfg = alertConfig[alert.alert_type];
  const sev = severityConfig[alert.severity];
  const Icon = cfg.icon;

  if (dismissed) return null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -15 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.3 }}
      onClick={() => !alert.read && onRead(alert.id)}
      className={cn(
        "relative rounded-xl border p-4 cursor-pointer transition-all duration-200 group",
        cfg.bg,
        !alert.read && "shadow-[0_0_15px_rgba(34,162,105,0.05)]"
      )}
    >
      {!alert.read && (
        <motion.div
          layoutId={`unread-${alert.id}`}
          className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-fin-400"
        />
      )}

      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105",
            cfg.bg
          )}
        >
          <Icon className={cn("w-4 h-4", cfg.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p
                className={cn(
                  "text-sm font-semibold",
                  !alert.read ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {alert.title}
              </p>
              <Badge variant={sev.variant} className="text-[10px] py-0">
                <span className={cn("w-1.5 h-1.5 rounded-full mr-1", sev.dot)} />
                {sev.label}
              </Badge>
              {!alert.read && (
                <span className="w-1.5 h-1.5 rounded-full bg-fin-400 animate-pulse" />
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {relativeTime(alert.createdAt)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDismissed(true);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded flex items-center justify-center hover:bg-white/10 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">{alert.description}</p>

          <div className="flex items-center gap-3 mt-2.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              {(alert.company ?? "—")} · {alert.ticker ?? "—"}
            </span>
            <button className="flex items-center gap-1 text-[10px] text-fin-400 hover:text-fin-300 transition-colors ml-auto">
              View Document <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Subscription row ──────────────────────────────────────────────────── */
function SubscriptionRow({
  sub,
  onUpdate,
  onDelete,
}: {
  sub: TickerSubscription;
  onUpdate: (id: string, patch: Partial<TickerSubscription>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-xl border p-4 transition-all duration-200",
        sub.active
          ? "border-white/[0.08] bg-card"
          : "border-white/[0.04] bg-card/50 opacity-60"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-fin-500/10 flex items-center justify-center font-bold text-xs text-fin-300 flex-shrink-0">
            {sub.ticker.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {sub.company_name ?? sub.ticker}
            </p>
            <p className="text-xs text-muted-foreground">{sub.ticker}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onDelete(sub.id)}
            className="text-[10px] text-muted-foreground hover:text-red-400 transition-colors"
            title="Unsubscribe"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-muted-foreground">
            {sub.active ? "Active" : "Paused"}
          </span>
          <Switch
            checked={sub.active}
            onCheckedChange={(v) => onUpdate(sub.id, { active: v })}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["subscribe_anomaly", "Anomaly", Activity],
            ["subscribe_sentiment", "Sentiment", TrendingDown],
            ["subscribe_filing", "Filing", FileText],
            ["subscribe_regulatory", "Regulatory", Shield],
          ] as const
        ).map(([key, label, Icon]) => {
          const enabled = sub[key];
          return (
            <button
              key={key}
              onClick={() => onUpdate(sub.id, { [key]: !enabled })}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-200",
                enabled
                  ? "bg-fin-500/15 border-fin-500/30 text-fin-300"
                  : "bg-transparent border-white/[0.07] text-muted-foreground hover:border-white/20"
              )}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── Stat pill ─────────────────────────────────────────────────────────── */
function StatPill({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.07] bg-card"
    >
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", color)}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
      </div>
    </motion.div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export default function AlertsPage() {
  const queryClient = useQueryClient();

  // ── Mock-mode state (used when IS_LIVE_API is false) ──────────────────
  const mockStoreAlerts = useAppStore((s) => s.alerts);
  const mockMarkRead = useAppStore((s) => s.markAlertRead);
  const mockMarkAllRead = useAppStore((s) => s.markAllAlertsRead);

  const [mockSubs, setMockSubs] = useState<TickerSubscription[]>(() =>
    mockSubscriptions.map((s, i) => ({
      id: `mock-sub-${i}`,
      user_id: "demo-user",
      workspace_id: DEFAULT_WORKSPACE_ID,
      ticker: s.ticker,
      company_name: s.company,
      subscribe_anomaly: s.anomaly,
      subscribe_sentiment: s.sentiment,
      subscribe_filing: s.filing,
      subscribe_regulatory: s.regulatory,
      email_notifications: true,
      active: s.active,
      last_edgar_check_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))
  );

  // ── Live-mode queries (no-op when IS_LIVE_API is false) ───────────────
  const liveAlertsQuery = useQuery<AlertListResponse, ApiError>({
    queryKey: ["alerts"],
    queryFn: () => listAlerts({ limit: 100 }),
    enabled: IS_LIVE_API,
    refetchInterval: 30_000, // poll every 30s for new anomalies / filings
  });

  const liveSubsQuery = useQuery<TickerSubscription[], ApiError>({
    queryKey: ["subscriptions"],
    queryFn: () => listSubscriptions(),
    enabled: IS_LIVE_API,
    staleTime: 60_000,
  });

  // ── Subscription mutations (live only) ────────────────────────────────
  const updateSubMutation = useMutation({
    mutationFn: (args: { id: string; patch: Partial<TickerSubscription> }) =>
      updateSubscription(args.id, args.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
  });

  const deleteSubMutation = useMutation({
    mutationFn: (id: string) => deleteSubscription(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
  });

  // ── Mark-read mutations (live) with optimistic update ─────────────────
  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiMarkRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["alerts"] });
      const prev = queryClient.getQueryData<AlertListResponse>(["alerts"]);
      if (prev) {
        queryClient.setQueryData<AlertListResponse>(["alerts"], {
          ...prev,
          items: prev.items.map((a) => (a.id === id ? { ...a, read: true } : a)),
          unread: Math.max(0, prev.unread - 1),
        });
      }
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["alerts"], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiMarkAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  // ── EDGAR manual-poll mutation ────────────────────────────────────────
  const edgarPollMutation = useMutation({
    mutationFn: () => triggerEdgarPoll(false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  // ── Build the unified normalised lists ────────────────────────────────
  const subscriptions: TickerSubscription[] = IS_LIVE_API
    ? liveSubsQuery.data ?? []
    : mockSubs;

  const companyByTicker = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subscriptions) if (s.ticker && s.company_name) m.set(s.ticker, s.company_name);
    return m;
  }, [subscriptions]);

  const allAlerts: NormAlert[] = useMemo(() => {
    if (IS_LIVE_API) {
      return (liveAlertsQuery.data?.items ?? []).map((a) =>
        normaliseLive(a, companyByTicker)
      );
    }
    return mockStoreAlerts.map(normaliseMock);
  }, [liveAlertsQuery.data, mockStoreAlerts, companyByTicker]);

  const unread = IS_LIVE_API
    ? liveAlertsQuery.data?.unread ?? 0
    : allAlerts.filter((a) => !a.read).length;

  const high = allAlerts.filter((a) => a.severity === "high").length;
  const activeSubs = subscriptions.filter((s) => s.active).length;

  // ── Filter pills ──────────────────────────────────────────────────────
  const [filter, setFilter] = useState<"all" | "unread" | "high">("all");
  const filtered = allAlerts.filter((a) => {
    if (filter === "unread") return !a.read;
    if (filter === "high") return a.severity === "high";
    return true;
  });

  // ── Subscribe dialog state ────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleMarkRead = (id: string) => {
    if (IS_LIVE_API) markReadMutation.mutate(id);
    else mockMarkRead(id);
  };

  const handleMarkAllRead = () => {
    if (IS_LIVE_API) markAllReadMutation.mutate();
    else mockMarkAllRead();
  };

  const handleSubUpdate = (id: string, patch: Partial<TickerSubscription>) => {
    if (IS_LIVE_API) {
      updateSubMutation.mutate({ id, patch });
    } else {
      setMockSubs((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch, updated_at: new Date().toISOString() } : s))
      );
    }
  };

  const handleSubDelete = (id: string) => {
    if (IS_LIVE_API) {
      deleteSubMutation.mutate(id);
    } else {
      setMockSubs((prev) => prev.filter((s) => s.id !== id));
    }
  };

  const handleSubCreated = (newSub: TickerSubscription) => {
    // In mock mode the dialog also calls our onCreate so we append locally.
    // In live mode the dialog already invalidates the React Query cache.
    if (!IS_LIVE_API) setMockSubs((prev) => [newSub, ...prev]);
  };

  const isLoading = IS_LIVE_API && (liveAlertsQuery.isLoading || liveSubsQuery.isLoading);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Alerts & Monitoring"
        subtitle="Real-time anomaly detection across your document corpus"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3"
        >
          <StatPill icon={Bell} label="Total Alerts" value={allAlerts.length} color="bg-fin-500/10 text-fin-400" />
          <StatPill icon={Eye} label="Unread" value={unread} color="bg-amber-500/10 text-amber-400" />
          <StatPill icon={AlertTriangle} label="High Severity" value={high} color="bg-red-500/10 text-red-400" />
          <StatPill icon={Zap} label="Monitored Tickers" value={activeSubs} color="bg-violet-500/10 text-violet-400" />
        </motion.div>

        {/* Live error banner (if any) */}
        {IS_LIVE_API && liveAlertsQuery.isError && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-300">
              Couldn't load alerts from /api/v1/alerts:{" "}
              <span className="font-mono">{(liveAlertsQuery.error as Error).message}</span>
            </p>
          </div>
        )}

        <Tabs defaultValue="feed">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <TabsList>
              <TabsTrigger value="feed">Alert Feed</TabsTrigger>
              <TabsTrigger value="subscriptions">
                Subscriptions ({subscriptions.length})
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              {/* Refresh + EDGAR-poll buttons (live only) */}
              {IS_LIVE_API && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => edgarPollMutation.mutate()}
                    disabled={edgarPollMutation.isPending}
                    title="Trigger EDGAR poll for your subscriptions"
                  >
                    {edgarPollMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    Poll EDGAR
                  </Button>
                </>
              )}

              {/* Filter pills */}
              {(["all", "unread", "high"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-full border transition-all duration-200 font-medium",
                    filter === f
                      ? "bg-fin-500/15 border-fin-500/30 text-fin-300"
                      : "border-white/[0.07] text-muted-foreground hover:border-white/20 hover:text-foreground"
                  )}
                >
                  {f === "all" ? "All" : f === "unread" ? `Unread (${unread})` : `High (${high})`}
                </button>
              ))}
            </div>
          </div>

          {/* ── Feed tab ── */}
          <TabsContent value="feed">
            {isLoading ? (
              <div className="flex flex-col items-center py-20 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin text-fin-400 mb-2" />
                <p className="text-xs">Loading alerts…</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {filtered.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center py-20 text-muted-foreground"
                  >
                    <BellOff className="w-10 h-10 mb-3 opacity-30" />
                    <p className="text-sm">No alerts in this view</p>
                  </motion.div>
                ) : (
                  <div className="space-y-3">
                    {filtered.map((alert) => (
                      <AlertCard key={alert.id} alert={alert} onRead={handleMarkRead} />
                    ))}
                  </div>
                )}
              </AnimatePresence>
            )}

            {/* Mark all read */}
            {unread > 0 && !isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 flex justify-center"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-xs"
                  onClick={handleMarkAllRead}
                  disabled={markAllReadMutation.isPending}
                >
                  {markAllReadMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  Mark all as read
                </Button>
              </motion.div>
            )}
          </TabsContent>

          {/* ── Subscriptions tab ── */}
          <TabsContent value="subscriptions">
            <div className="space-y-4">
              {/* Add new — now opens the real dialog */}
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setDialogOpen(true)}
                className="w-full rounded-xl border border-dashed border-white/10 p-4 flex items-center justify-between hover:border-fin-500/30 hover:bg-fin-500/5 transition-all duration-200 group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] group-hover:bg-fin-500/10 flex items-center justify-center transition-colors">
                    <Plus className="w-4 h-4 text-muted-foreground group-hover:text-fin-400 transition-colors" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Add Ticker to Monitor</p>
                    <p className="text-xs text-muted-foreground">
                      Track anomalies, filings, and sentiment shifts
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-fin-500/10 border border-fin-500/20 text-fin-300 font-medium group-hover:bg-fin-500/15 transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                  Add Ticker
                </span>
              </motion.button>

              {/* Subscriptions list */}
              {isLoading ? (
                <div className="flex flex-col items-center py-12 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin text-fin-400 mb-2" />
                  <p className="text-xs">Loading subscriptions…</p>
                </div>
              ) : subscriptions.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-muted-foreground rounded-xl border border-white/[0.06] bg-card/50">
                  <BellOff className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-sm">No subscriptions yet</p>
                  <p className="text-xs">Click "Add Ticker" above to start monitoring a company.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {subscriptions.map((sub, i) => (
                    <motion.div
                      key={sub.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                    >
                      <SubscriptionRow
                        sub={sub}
                        onUpdate={handleSubUpdate}
                        onDelete={handleSubDelete}
                      />
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Alert delivery settings (mock-only, same UI as Phase 3) */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="gradient-card p-5 mt-6"
              >
                <h3 className="text-sm font-semibold mb-4">Alert Delivery</h3>
                <div className="space-y-3">
                  {[
                    { label: "In-app notifications", desc: "Real-time alerts in the dashboard", enabled: true },
                    { label: "Email digest", desc: "Daily summary at 8 AM EST", enabled: true },
                    { label: "Slack webhook", desc: "Push to #fin-alerts channel", enabled: false },
                    { label: "PagerDuty escalation", desc: "For high-severity anomalies only", enabled: false },
                  ].map((item, i) => (
                    <motion.div
                      key={item.label}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 + i * 0.07 }}
                      className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.desc}</p>
                      </div>
                      <Switch defaultChecked={item.enabled} />
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* The dialog — owns its own form state, calls onCreate on success */}
      <SubscribeTickerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workspaceId={DEFAULT_WORKSPACE_ID}
        onCreate={handleSubCreated}
      />
    </div>
  );
}
