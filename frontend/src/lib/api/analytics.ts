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
