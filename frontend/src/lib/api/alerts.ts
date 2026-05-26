/**
 * Alerts + ticker-subscription API client — Phase 3 Week 6.
 *
 * Backed by the FastAPI endpoints at /api/v1/alerts/*.
 *
 * The existing alerts page (app/(app)/alerts/page.tsx) currently uses
 * mock data via the Zustand store. This client exposes typed fetchers and
 * a `useLiveAlerts` hook so the page can opt into live data when
 * NEXT_PUBLIC_API_URL is set, falling back to mock data otherwise.
 */
import { useEffect, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

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

// ── HTTP helper ──────────────────────────────────────────────────────────────
async function authedFetch(
  path: string,
  init: RequestInit = {},
  getToken?: () => Promise<string | null>
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  if (getToken) {
    const token = await getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return response;
}

// ── Alerts ───────────────────────────────────────────────────────────────────
export async function listAlerts(
  params: ListAlertsParams = {},
  getToken?: () => Promise<string | null>
): Promise<AlertListResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) query.set(k, String(v));
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await authedFetch(`/alerts${suffix}`, {}, getToken);
  return response.json();
}

export async function markAlertRead(
  alertId: string,
  getToken?: () => Promise<string | null>
): Promise<AlertOut> {
  const response = await authedFetch(
    `/alerts/${alertId}/read`,
    { method: "PATCH" },
    getToken
  );
  return response.json();
}

export async function markAllAlertsRead(
  workspaceId?: string,
  getToken?: () => Promise<string | null>
): Promise<{ updated: number }> {
  const suffix = workspaceId ? `?workspace_id=${workspaceId}` : "";
  const response = await authedFetch(
    `/alerts/read-all${suffix}`,
    { method: "POST" },
    getToken
  );
  return response.json();
}

// ── Subscriptions ────────────────────────────────────────────────────────────
export async function listSubscriptions(
  workspaceId?: string,
  getToken?: () => Promise<string | null>
): Promise<TickerSubscription[]> {
  const suffix = workspaceId ? `?workspace_id=${workspaceId}` : "";
  const response = await authedFetch(
    `/alerts/subscriptions${suffix}`,
    {},
    getToken
  );
  return response.json();
}

export async function createSubscription(
  input: CreateSubscriptionInput,
  getToken?: () => Promise<string | null>
): Promise<TickerSubscription> {
  const response = await authedFetch(
    `/alerts/subscriptions`,
    { method: "POST", body: JSON.stringify(input) },
    getToken
  );
  return response.json();
}

export async function updateSubscription(
  subscriptionId: string,
  patch: Partial<Omit<TickerSubscription, "id" | "user_id" | "created_at" | "updated_at">>,
  getToken?: () => Promise<string | null>
): Promise<TickerSubscription> {
  const response = await authedFetch(
    `/alerts/subscriptions/${subscriptionId}`,
    { method: "PATCH", body: JSON.stringify(patch) },
    getToken
  );
  return response.json();
}

export async function deleteSubscription(
  subscriptionId: string,
  getToken?: () => Promise<string | null>
): Promise<void> {
  await authedFetch(
    `/alerts/subscriptions/${subscriptionId}`,
    { method: "DELETE" },
    getToken
  );
}

// ── React hook for live alerts (optional, used by alerts page) ───────────────
export function useLiveAlerts(
  params: ListAlertsParams = {},
  getToken?: () => Promise<string | null>,
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
