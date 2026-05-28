/**
 * Analytics API client — Phase 4 Week 8 wiring for the dashboard + analytics page.
 *
 * Mirrors backend/app/api/routes/analytics.py:
 *   GET  /analytics/health
 *   GET  /analytics/pipeline
 *   GET  /analytics/stats?workspace_id=…
 *   GET  /analytics/audit/workspace/{workspace_id}?days=30
 *   GET  /analytics/audit/user/{user_id}
 *   POST /analytics/audit/token-usage
 */
import { apiFetch, type GetTokenFn } from "./client";

export interface DocumentStats {
  total_documents: number;
  indexed: number;
  processing: number;
  failed: number;
  total_chunks: number;
  total_queries: number;
}

export interface PipelineStageStatus {
  stage: string;
  status: "ok" | "degraded" | "down" | "not_configured" | "disabled";
  latency_ms: number | null;
  detail: string | null;
}

export interface PipelineHealthResponse {
  overall: string;
  stages: PipelineStageStatus[];
}

export interface WorkspaceAnalytics {
  workspace_id: string;
  period_days: number;
  analytics: {
    workspace_id: string;
    days: number;
    postgres: {
      source?: string;
      total_queries?: number;
      avg_confidence?: number;
      model_distribution?: Record<string, number>;
      note?: string;
    };
    dynamodb: {
      total_queries?: number;
      avg_confidence?: number;
      avg_latency_ms?: number;
      total_tokens?: number;
      model_distribution?: Record<string, number>;
      error?: string;
      disabled?: boolean;
    };
  };
  generated_at: number;
}

export interface TokenUsageResponse {
  period_days: number;
  workspace_count: number;
  total_queries: number;
  total_tokens: number;
  estimated_cost_usd: number;
  workspace_breakdown: Record<string, unknown>;
  note?: string;
  error?: string;
}

/**
 * Mirrors the wrapper response from
 *   GET /api/v1/analytics/audit/user/{target_user_id}
 *
 * Note: the backend's `audit_trail` payload is mostly a placeholder today —
 * `postgres_logs` is always empty pending the DB query implementation, and
 * `dynamodb_logs` only populates when USE_DYNAMODB=true. We model the shape
 * faithfully so the UI can degrade gracefully and surface a "no data" state
 * without us having to refactor the type later.
 */
export interface UserAuditTrailEntry {
  /** Free-form fields — DynamoDB items have many shapes across migrations. */
  query_log_id?: string;
  workspace_id?: string;
  query_text?: string;
  answer_text?: string;
  confidence_score?: number;
  latency_ms?: number;
  model_used?: string;
  total_tokens?: number;
  /** Allow unknown extra keys without losing autocomplete on the known ones. */
  [key: string]: unknown;
}

export interface UserAuditTrailResponse {
  target_user_id: string;
  requested_by: string;
  date_range: { start: string | null; end: string | null };
  limit: number;
  audit_trail: {
    user_id: string;
    postgres_logs: UserAuditTrailEntry[];
    dynamodb_logs: UserAuditTrailEntry[];
    total_entries: number;
  };
  compliance_note: string;
  /** Unix-epoch seconds. */
  generated_at: number;
}

/**
 * Mirrors `HealthResponse` from backend/app/db/schemas.py. The `status`
 * field is "ok" when the API + database are reachable, "degraded" when
 * either is failing. Used by the Header dot indicator.
 */
export interface ApiHealthResponse {
  status: "ok" | "degraded" | string;
  database: string;
  version: string;
  environment: string;
}

/**
 * GET /analytics/health — no-auth health probe.
 *
 * `getToken` is accepted for symmetry with the other helpers but is a
 * no-op against this endpoint. The Header indicator polls this every
 * 30 s; treat any non-2xx as a fault and render the "down" dot.
 */
export async function getApiHealth(
  getToken?: GetTokenFn,
): Promise<ApiHealthResponse> {
  return apiFetch<ApiHealthResponse>("/analytics/health", { getToken });
}

export async function getWorkspaceStats(
  workspaceId: string,
  getToken?: GetTokenFn
): Promise<DocumentStats> {
  return apiFetch<DocumentStats>("/analytics/stats", {
    query: { workspace_id: workspaceId },
    getToken,
  });
}

export async function getPipelineHealth(
  getToken?: GetTokenFn
): Promise<PipelineHealthResponse> {
  return apiFetch<PipelineHealthResponse>("/analytics/pipeline", { getToken });
}

export async function getWorkspaceAuditAnalytics(
  workspaceId: string,
  days = 30,
  getToken?: GetTokenFn
): Promise<WorkspaceAnalytics> {
  return apiFetch<WorkspaceAnalytics>(
    `/analytics/audit/workspace/${workspaceId}`,
    {
      query: { days },
      getToken,
    }
  );
}

export async function getTokenUsage(
  workspaceIds: string[],
  days = 30,
  getToken?: GetTokenFn
): Promise<TokenUsageResponse> {
  return apiFetch<TokenUsageResponse>("/analytics/audit/token-usage", {
    method: "POST",
    json: workspaceIds,
    query: { days },
    getToken,
  });
}

/**
 * GET /analytics/audit/user/{target_user_id}
 *
 * Backend currently enforces self-access only (`target_user_id` must equal
 * the calling user's UUID). Pass the User UUID — NOT the Clerk user id.
 * Resolve the UUID via `getMe()` before calling this.
 */
export async function getUserAuditAnalytics(
  targetUserId: string,
  opts: {
    /** ISO yyyy-mm-dd, inclusive lower bound. */
    startDate?: string;
    /** ISO yyyy-mm-dd, inclusive upper bound. */
    endDate?: string;
    /** Hard cap on rows returned across both stores; backend max is 1000. */
    limit?: number;
  } = {},
  getToken?: GetTokenFn,
): Promise<UserAuditTrailResponse> {
  const query: Record<string, string | number | undefined> = {
    limit: opts.limit ?? 100,
  };
  if (opts.startDate) query.start_date = opts.startDate;
  if (opts.endDate) query.end_date = opts.endDate;
  return apiFetch<UserAuditTrailResponse>(
    `/analytics/audit/user/${targetUserId}`,
    { query, getToken },
  );
}
