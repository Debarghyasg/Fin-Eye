"use client";
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell, BellOff, Filter, Check, AlertTriangle, TrendingDown,
  FileText, Shield, Plus, X, Trash2, ChevronRight, Activity,
  Zap, Eye,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { mockAlerts, mockSubscriptions } from "@/lib/mock-data";
import { useAppStore } from "@/store/useAppStore";
import { cn, relativeTime } from "@/lib/utils";

/* ── Alert type config ──────────────────────────────────────── */
const alertConfig = {
  anomaly: {
    icon: Activity,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    badge: "warning" as const,
  },
  sentiment: {
    icon: TrendingDown,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    badge: "info" as const,
  },
  regulatory: {
    icon: Shield,
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
    badge: "processing" as const,
  },
  filing: {
    icon: FileText,
    color: "text-fin-400",
    bg: "bg-fin-500/10 border-fin-500/20",
    badge: "default" as const,
  },
};

const severityConfig = {
  high: { label: "High", variant: "destructive" as const, dot: "bg-red-400" },
  medium: { label: "Medium", variant: "warning" as const, dot: "bg-amber-400" },
  low: { label: "Low", variant: "default" as const, dot: "bg-fin-400" },
  info: { label: "Info", variant: "secondary" as const, dot: "bg-muted-foreground" },
};

/* ── Single Alert Card ──────────────────────────────────────── */
function AlertCard({
  alert,
  onRead,
}: {
  alert: (typeof mockAlerts)[number];
  onRead: (id: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const cfg = alertConfig[alert.type];
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
      {/* Unread indicator */}
      {!alert.read && (
        <motion.div
          layoutId={`unread-${alert.id}`}
          className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-fin-400"
        />
      )}

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105",
          cfg.bg
        )}>
          <Icon className={cn("w-4 h-4", cfg.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={cn("text-sm font-semibold", !alert.read ? "text-foreground" : "text-muted-foreground")}>
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
                {relativeTime(alert.timestamp)}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded flex items-center justify-center hover:bg-white/10 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">{alert.description}</p>

          <div className="flex items-center gap-3 mt-2.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              {alert.company} · {alert.ticker}
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

/* ── Subscription row ───────────────────────────────────────── */
function SubscriptionRow({ sub }: { sub: (typeof mockSubscriptions)[number] }) {
  const [active, setActive] = useState(sub.active);
  const [settings, setSettings] = useState({
    anomaly: sub.anomaly,
    sentiment: sub.sentiment,
    filing: sub.filing,
    regulatory: sub.regulatory,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-xl border p-4 transition-all duration-200",
        active ? "border-white/[0.08] bg-card" : "border-white/[0.04] bg-card/50 opacity-60"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-fin-500/10 flex items-center justify-center font-bold text-xs text-fin-300">
            {sub.ticker.slice(0, 2)}
          </div>
          <div>
            <p className="text-sm font-semibold">{sub.company}</p>
            <p className="text-xs text-muted-foreground">{sub.ticker}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{active ? "Active" : "Paused"}</span>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["anomaly", "sentiment", "filing", "regulatory"] as const).map((type) => {
          const icons = { anomaly: Activity, sentiment: TrendingDown, filing: FileText, regulatory: Shield };
          const Icon = icons[type];
          return (
            <button
              key={type}
              onClick={() => setSettings((s) => ({ ...s, [type]: !s[type] }))}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-200",
                settings[type]
                  ? "bg-fin-500/15 border-fin-500/30 text-fin-300"
                  : "bg-transparent border-white/[0.07] text-muted-foreground hover:border-white/20"
              )}
            >
              <Icon className="w-3 h-3" />
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── Stats bar ──────────────────────────────────────────────── */
function StatPill({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string | number; color: string }) {
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

/* ── Page ───────────────────────────────────────────────────── */
export default function AlertsPage() {
  const { alerts, markAlertRead } = useAppStore();
  const [filter, setFilter] = useState<"all" | "unread" | "high">("all");

  const filtered = alerts.filter((a) => {
    if (filter === "unread") return !a.read;
    if (filter === "high") return a.severity === "high";
    return true;
  });

  const unread = alerts.filter((a) => !a.read).length;
  const high = alerts.filter((a) => a.severity === "high").length;

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
          <StatPill icon={Bell} label="Total Alerts" value={alerts.length} color="bg-fin-500/10 text-fin-400" />
          <StatPill icon={Eye} label="Unread" value={unread} color="bg-amber-500/10 text-amber-400" />
          <StatPill icon={AlertTriangle} label="High Severity" value={high} color="bg-red-500/10 text-red-400" />
          <StatPill icon={Zap} label="Monitored Tickers" value={mockSubscriptions.filter(s => s.active).length} color="bg-violet-500/10 text-violet-400" />
        </motion.div>

        <Tabs defaultValue="feed">
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="feed">Alert Feed</TabsTrigger>
              <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
            </TabsList>

            {/* Filter pills */}
            <div className="flex items-center gap-2">
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
                    <AlertCard key={alert.id} alert={alert} onRead={markAlertRead} />
                  ))}
                </div>
              )}
            </AnimatePresence>

            {/* Mark all read */}
            {unread > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 flex justify-center"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-xs"
                  onClick={() => alerts.filter((a) => !a.read).forEach((a) => markAlertRead(a.id))}
                >
                  <Check className="w-3.5 h-3.5" />
                  Mark all as read
                </Button>
              </motion.div>
            )}
          </TabsContent>

          {/* ── Subscriptions tab ── */}
          <TabsContent value="subscriptions">
            <div className="space-y-4">
              {/* Add new */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl border border-dashed border-white/10 p-4 flex items-center justify-between hover:border-fin-500/30 hover:bg-fin-500/5 transition-all duration-200 cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] group-hover:bg-fin-500/10 flex items-center justify-center transition-colors">
                    <Plus className="w-4 h-4 text-muted-foreground group-hover:text-fin-400 transition-colors" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Add Ticker to Monitor</p>
                    <p className="text-xs text-muted-foreground">Track anomalies, filings, and sentiment shifts</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Plus className="w-3.5 h-3.5" />
                  Add Ticker
                </Button>
              </motion.div>

              {/* Subscriptions list */}
              <div className="space-y-3">
                {mockSubscriptions.map((sub, i) => (
                  <motion.div
                    key={sub.ticker}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07 }}
                  >
                    <SubscriptionRow sub={sub} />
                  </motion.div>
                ))}
              </div>

              {/* Alert delivery settings */}
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
    </div>
  );
}
