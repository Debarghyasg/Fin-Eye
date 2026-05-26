/**
 * Alerts + ticker-subscription API client — Phase 3 Week 6 → refactored
 * onto the shared apiFetch helper in Phase 4.
 *
 * Backed by FastAPI endpoints at /api/v1/alerts/*.
 */
import { useEffect, useState } from "react";

import { apiFetch, type GetTokenFn } from "./client";

export type AlertType = "anomaly" | "sentiment" | "regulatory" | "filing";
export type AlertSeverity = "high" | "medium" | "low" | "info";

export interface AlertOut {
  id: string;
  workspace_id: string;
  user_id: string | null;
  document_id: string | null;
  ticker: string | null;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  metric_name: string | null;
  metric_value: number | null;
  z_score: number | null;
  historical_mean: number | null;
  historical_stdev: number | null;
  sample_size: number | null;
  read: boolean;
  email_sent: boolean;
  created_at: string;
}

export interface AlertListResponse {
  items: AlertOut[];
  total: number;
  unread: number;
}

export interface TickerSubscription {
  id: string;
  user_id: string;
  workspace_id: string;
  ticker: string;
  company_name: string | null;
  subscribe_anomaly: boolean;
  subscribe_sentiment: boolean;
  subscribe_filing: boolean;
  subscribe_regulatory: boolean;
  email_notifications: boolean;
  active: boolean;
  last_edgar_check_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSubscriptionInput {
  workspace_id: string;
  ticker: string;
  company_name?: string;
  subscribe_anomaly?: boolean;
  subscribe_sentiment?: boolean;
  subscribe_filing?: boolean;
  subscribe_regulatory?: boolean;
  email_notifications?: boolean;
}

export interface ListAlertsParams {
  workspace_id?: string;
  ticker?: string;
  alert_type?: AlertType;
  severity?: AlertSeverity;
  unread_only?: boolean;
  limit?: number;
  offset?: number;
}

// ── Alerts ───────────────────────────────────────────────────────────────────
export async function listAlerts(
  params: ListAlertsParams = {},
  getToken?: GetTokenFn
): Promise<AlertListResponse> {
  return apiFetch<AlertListResponse>("/alerts", { query: params, getToken });
}

export async function markAlertRead(
  alertId: string,
  getToken?: GetTokenFn
): Promise<AlertOut> {
  return apiFetch<AlertOut>(`/alerts/${alertId}/read`, {
    method: "PATCH",
    getToken,
  });
}

export async function markAllAlertsRead(
  workspaceId?: string,
  getToken?: GetTokenFn
): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>("/alerts/read-all", {
    method: "POST",
    query: workspaceId ? { workspace_id: workspaceId } : undefined,
    getToken,
  });
}

// ── Subscriptions ────────────────────────────────────────────────────────────
export async function listSubscriptions(
  workspaceId?: string,
  getToken?: GetTokenFn
): Promise<TickerSubscription[]> {
  return apiFetch<TickerSubscription[]>("/alerts/subscriptions", {
    query: workspaceId ? { workspace_id: workspaceId } : undefined,
    getToken,
  });
}

export async function createSubscription(
  input: CreateSubscriptionInput,
  getToken?: GetTokenFn
): Promise<TickerSubscription> {
  return apiFetch<TickerSubscription>("/alerts/subscriptions", {
    method: "POST",
    json: input,
    getToken,
  });
}

export async function updateSubscription(
  subscriptionId: string,
  patch: Partial<Omit<TickerSubscription, "id" | "user_id" | "created_at" | "updated_at">>,
  getToken?: GetTokenFn
): Promise<TickerSubscription> {
  return apiFetch<TickerSubscription>(`/alerts/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    json: patch,
    getToken,
  });
}

export async function deleteSubscription(
  subscriptionId: string,
  getToken?: GetTokenFn
): Promise<void> {
  await apiFetch(`/alerts/subscriptions/${subscriptionId}`, {
    method: "DELETE",
    getToken,
  });
}

// ── EDGAR ────────────────────────────────────────────────────────────────────
export interface EdgarPollResult {
  subscriptions_checked: number;
  total_new_filings: number;
  alerts_created: number;
  emails_sent: number;
  results: Array<{
    ticker: string;
    checked: boolean;
    new_filings: number;
    alerts_created: number;
    error: string | null;
  }>;
}

export async function triggerEdgarPoll(
  dispatchEmails = false,
  getToken?: GetTokenFn
): Promise<EdgarPollResult> {
  return apiFetch<EdgarPollResult>("/alerts/edgar/poll", {
    method: "POST",
    query: { dispatch_emails: dispatchEmails },
    getToken,
  });
}

// ── React hook for live alerts (kept for compatibility — pages now prefer
// React Query directly) ─────────────────────────────────────────────────────
export function useLiveAlerts(
  params: ListAlertsParams = {},
  getToken?: GetTokenFn,
  pollMs = 30_000
) {
  const [data, setData] = useState<AlertListResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const result = await listAlerts(params, getToken);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    if (pollMs > 0) interval = setInterval(load, pollMs);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params), pollMs]);

  return { data, error, loading };
}
