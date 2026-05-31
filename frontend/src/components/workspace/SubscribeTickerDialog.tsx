"use client";
/**
 * SubscribeTickerDialog — Phase 4 Week 8 Day 6-7.
 *
 * The "user types a ticker, clicks subscribe, and the system starts
 * monitoring EDGAR for that company" flow from the spec.
 *
 *   - Ticker input (auto-uppercased, alphanumeric only, 1-10 chars)
 *   - Optional company name (free-text)
 *   - Per-channel toggles: anomaly / sentiment / filing / regulatory
 *   - Email-notifications master toggle
 *   - Submit → POST /api/v1/alerts/subscriptions when IS_LIVE_API,
 *     otherwise just emits an `onCreate` callback so the alerts page
 *     can append to its local mock list.
 *   - Success state in the dialog confirms "we're monitoring EDGAR" and
 *     auto-dismisses after 1.6s.
 *   - Errors render inline (no toast infra needed).
 *
 * Designed to be uncontrolled wrt open state — accepts `open`/`onOpenChange`
 * so the alerts page owns the dialog lifecycle.
 */
import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, AlertCircle, AlertTriangle, Bell, Check,
  CheckCircle2, FileText, Loader2, Plus, Shield, TrendingDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  IS_LIVE_API,
  ApiError,
  createSubscription,
  type CreateSubscriptionInput,
  type TickerSubscription,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

const CHANNELS = [
  {
    key: "subscribe_anomaly" as const,
    labelKey: "subscribe.anomalyTitle",
    descKey: "subscribe.anomalyDesc",
    icon: Activity,
    color: "text-amber-400 bg-amber-500/10",
  },
  {
    key: "subscribe_sentiment" as const,
    labelKey: "subscribe.sentimentTitle",
    descKey: "subscribe.sentimentDesc",
    icon: TrendingDown,
    color: "text-blue-400 bg-blue-500/10",
  },
  {
    key: "subscribe_filing" as const,
    labelKey: "subscribe.filingTitle",
    descKey: "subscribe.filingDesc",
    icon: FileText,
    color: "text-fin-400 bg-fin-500/10",
  },
  {
    key: "subscribe_regulatory" as const,
    labelKey: "subscribe.regulatoryTitle",
    descKey: "subscribe.regulatoryDesc",
    icon: Shield,
    color: "text-violet-400 bg-violet-500/10",
  },
];

interface SubscribeTickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The workspace the new subscription should belong to. */
  workspaceId: string;
  /** Called after a successful subscription. Used in mock mode to append
   *  to the page's local list, and in live mode for any optimistic UI. */
  onCreate?: (subscription: TickerSubscription) => void;
}

interface FormState {
  ticker: string;
  companyName: string;
  subscribe_anomaly: boolean;
  subscribe_sentiment: boolean;
  subscribe_filing: boolean;
  subscribe_regulatory: boolean;
  email_notifications: boolean;
}

const DEFAULT_FORM: FormState = {
  ticker: "",
  companyName: "",
  subscribe_anomaly: true,
  subscribe_sentiment: true,
  subscribe_filing: true,
  subscribe_regulatory: false,
  email_notifications: true,
};

function buildSyntheticSubscription(
  workspaceId: string,
  form: FormState
): TickerSubscription {
  const now = new Date().toISOString();
  return {
    id: `sub-${Date.now()}`,
    user_id: "demo-user",
    workspace_id: workspaceId,
    ticker: form.ticker.trim().toUpperCase(),
    company_name: form.companyName.trim() || null,
    subscribe_anomaly: form.subscribe_anomaly,
    subscribe_sentiment: form.subscribe_sentiment,
    subscribe_filing: form.subscribe_filing,
    subscribe_regulatory: form.subscribe_regulatory,
    email_notifications: form.email_notifications,
    active: true,
    last_edgar_check_at: null,
    created_at: now,
    updated_at: now,
  };
}

export function SubscribeTickerDialog({
  open,
  onOpenChange,
  workspaceId,
  onCreate,
}: SubscribeTickerDialogProps) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [success, setSuccess] = useState<TickerSubscription | null>(null);
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const { t } = useTranslation();

  // Reset form whenever the dialog reopens
  useEffect(() => {
    if (open) {
      setForm(DEFAULT_FORM);
      setSuccess(null);
    }
  }, [open]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Live mode mutation
  const liveMutation = useMutation<TickerSubscription, ApiError, CreateSubscriptionInput>({
    mutationFn: (input) => createSubscription(input, getToken),
    onSuccess: (sub) => {
      // Refetch the list so the page reflects the new subscription
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      setSuccess(sub);
      onCreate?.(sub);
    },
  });

  const tickerError = (() => {
    const t2 = form.ticker.trim();
    if (t2.length === 0) return null; // handled by submit-disabled
    if (t2.length > 10) return t("subscribe.errLength");
    if (!/^[A-Z0-9.]{1,10}$/.test(t2.toUpperCase()))
      return t("subscribe.errChars");
    return null;
  })();

  const submitDisabled =
    form.ticker.trim().length === 0 ||
    !!tickerError ||
    liveMutation.isPending ||
    !!success;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitDisabled) return;

    const ticker = form.ticker.trim().toUpperCase();

    if (IS_LIVE_API) {
      liveMutation.mutate({
        workspace_id: workspaceId,
        ticker,
        company_name: form.companyName.trim() || undefined,
        subscribe_anomaly: form.subscribe_anomaly,
        subscribe_sentiment: form.subscribe_sentiment,
        subscribe_filing: form.subscribe_filing,
        subscribe_regulatory: form.subscribe_regulatory,
        email_notifications: form.email_notifications,
      });
    } else {
      const sub = buildSyntheticSubscription(workspaceId, { ...form, ticker });
      onCreate?.(sub);
      setSuccess(sub);
    }
  };

  // Auto-dismiss the dialog 1.6s after success so the user sees the
  // confirmation and the modal still closes itself
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => onOpenChange(false), 1600);
      return () => clearTimeout(t);
    }
  }, [success, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="overflow-visible">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-fin-500/10 flex items-center justify-center">
              <Bell className="w-3.5 h-3.5 text-fin-400" />
            </span>
            {t("subscribe.title")}
          </DialogTitle>
          <DialogDescription>
            {t("subscribe.description")}
          </DialogDescription>        </DialogHeader>

        <AnimatePresence mode="wait">
          {success ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="py-6 flex flex-col items-center text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 18, delay: 0.05 }}
                className="w-12 h-12 rounded-full bg-fin-500/15 flex items-center justify-center mb-3"
              >
                <CheckCircle2 className="w-6 h-6 text-fin-400" />
              </motion.div>
              <p className="text-sm font-semibold mb-1">
                {t("subscribe.nowMonitoring")}{" "}
                <span className="text-fin-300">{success.ticker}</span>
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                {IS_LIVE_API
                  ? t("subscribe.monitoringLive")
                  : t("subscribe.monitoringMock")}
              </p>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onSubmit={submit}
              className="space-y-4"
            >
              {/* Ticker + company */}
              <div className="grid grid-cols-[1fr_2fr] gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    {t("subscribe.ticker")}
                  </label>
                  <Input
                    autoFocus
                    value={form.ticker}
                    onChange={(e) =>
                      setField(
                        "ticker",
                        e.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 10)
                      )
                    }
                    placeholder="e.g. AAPL"
                    className={cn(
                      "uppercase font-mono",
                      tickerError && "border-red-500/40 focus-visible:ring-red-500/20"
                    )}
                  />
                  {tickerError && (
                    <p className="text-[10px] text-red-400">{tickerError}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    {t("subscribe.companyOptional")}
                  </label>
                  <Input
                    value={form.companyName}
                    onChange={(e) => setField("companyName", e.target.value)}
                    placeholder="Apple Inc."
                  />
                </div>
              </div>

              {/* Channels */}
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  {t("subscribe.alertChannels")}
                </p>
                <div className="space-y-1.5">
                  {CHANNELS.map((ch) => {
                    const Icon = ch.icon;
                    const enabled = form[ch.key];
                    return (
                      <label
                        key={ch.key}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all",
                          enabled
                            ? "border-fin-500/25 bg-fin-500/5"
                            : "border-white/[0.06] bg-card/50 hover:border-white/15"
                        )}
                      >
                        <div
                          className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                            ch.color
                          )}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground">{t(ch.labelKey)}</p>
                          <p className="text-[10px] text-muted-foreground">{t(ch.descKey)}</p>
                        </div>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => setField(ch.key, v)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Email toggle */}
              <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-white/[0.06] bg-card/50 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Bell className="w-3.5 h-3.5 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium">{t("subscribe.emailTitle")}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("subscribe.emailDesc")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={form.email_notifications}
                  onCheckedChange={(v) => setField("email_notifications", v)}
                />
              </label>

              {/* Live API error */}
              {liveMutation.isError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">
                    {(liveMutation.error as ApiError | Error)?.message ??
                      t("subscribe.errorCreate")}
                  </p>
                </div>
              )}

              {/* Demo-mode hint */}
              {!IS_LIVE_API && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
                  <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-300">
                    {t("subscribe.demoHint")}
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={liveMutation.isPending}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" variant="glow" disabled={submitDisabled} className="gap-1.5">
                  {liveMutation.isPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {t("subscribe.subscribing")}
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      {t("subscribe.subscribe")}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </motion.form>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
