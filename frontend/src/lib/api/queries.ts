/**
 * Queries API client — Phase 4 wiring for the workspace chat panel.
 *
 * Mirrors backend/app/api/routes/queries.py:
 *   POST /queries           — submit a RAG query, returns QueryResponse with citations
 *   GET  /queries/history   — paginated audit log of past queries
 */
import { apiFetch, type GetTokenFn } from "./client";
import type { PaginatedList } from "./documents";

export interface CitationDetail {
  chunk_id: string;
  page_number: number | null;
  excerpt: string;
  document_name: string;
}

export interface SourceReference {
  document_id: string;
  chunk_id: string;
  page_number: number | null;
  excerpt: string;
  score: number;
}

export interface QueryRequest {
  query: string;
  workspace_id: string;
  document_ids?: string[];
  top_k?: number;
}

export interface QueryResponse {
  query_log_id: string;
  query: string;
  answer: string;
  confidence: number;
  citations: CitationDetail[];
  sources: SourceReference[];
  latency_ms: number;
  model_used: string;
}

export interface QueryHistoryItem {
  id: string;
  user_id: string | null;
  workspace_id: string | null;
  query_text: string;
  answer_text: string | null;
  confidence_score: number | null;
  source_chunk_ids: string | null; // JSON-encoded list[str]
  source_doc_ids: string | null; // JSON-encoded list[str]
  latency_ms: number | null;
  model_used: string | null;
  created_at: string;
}

export async function submitQuery(
  body: QueryRequest,
  getToken?: GetTokenFn
): Promise<QueryResponse> {
  return apiFetch<QueryResponse>("/queries", {
    method: "POST",
    json: body,
    getToken,
  });
}

export async function getQueryHistory(
  workspaceId: string,
  opts: { page?: number; page_size?: number } = {},
  getToken?: GetTokenFn
): Promise<PaginatedList<QueryHistoryItem>> {
  return apiFetch<PaginatedList<QueryHistoryItem>>("/queries/history", {
    query: {
      workspace_id: workspaceId,
      page: opts.page ?? 1,
      page_size: opts.page_size ?? 20,
    },
    getToken,
  });
}
