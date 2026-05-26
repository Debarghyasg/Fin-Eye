/**
 * Comparisons API client — Phase 4 wiring for the Compare page.
 *
 * Mirrors backend/app/api/routes/comparisons.py (Phase 3 Week 5).
 */
import { apiFetch, type GetTokenFn } from "./client";

export interface DocumentComparisonRequest {
  document_a_id: string;
  document_b_id: string;
  include_sentiment?: boolean;
  include_narrative?: boolean;
}

export interface FinancialMetricComparison {
  metric_name: string;
  old_value: number | null;
  new_value: number | null;
  absolute_change: number | null;
  percentage_change: number | null;
  direction: "increase" | "decrease" | "flat";
  significance: "major" | "moderate" | "minor" | "negligible" | "unknown";
}

export interface DocumentSummary {
  id: string;
  filename: string;
  company: string | null;
  ticker: string | null;
  period: string | null;
  doc_type: string | null;
}

export interface SentimentShift {
  direction: "more_positive" | "more_negative";
  magnitude: number;
  significance: "major" | "moderate" | "minor" | "negligible";
}

export interface SentimentAnalysisResult {
  period_a_sentiment?: {
    positive: number;
    neutral: number;
    negative: number;
    dominant: string;
    confidence: string;
  };
  period_b_sentiment?: {
    positive: number;
    neutral: number;
    negative: number;
    dominant: string;
    confidence: string;
  };
  sentiment_shift?: SentimentShift;
  detailed_changes?: {
    positive_change: number;
    negative_change: number;
    neutral_change: number;
  };
  interpretation?: string;
  error?: string;
}

export interface DocumentComparisonResult {
  comparison_id: string;
  status: "processing" | "completed" | "failed";
  documents: {
    document_a: DocumentSummary;
    document_b: DocumentSummary;
  };
  financial_metrics: FinancialMetricComparison[];
  risk_factor_changes: {
    added: Array<{ category: string; description: string; severity: string }>;
    removed: Array<{ category: string; description: string; severity: string }>;
    count_a: number;
    count_b: number;
  } | null;
  guidance_change: {
    tone_a: string | null;
    tone_b: string | null;
    shifted: boolean;
  } | null;
  sentiment_analysis: SentimentAnalysisResult | null;
  narrative_summary: string | null;
  summary_statistics: Record<string, unknown>;
  processing_time_ms: number | null;
  error_message: string | null;
  created_at: string;
}

export interface ComparisonListItem {
  id: string;
  workspace_id: string;
  document_a_id: string;
  document_b_id: string;
  status: string;
  total_metrics_compared: number;
  metrics_with_significant_changes: number;
  overall_sentiment_shift: string | null;
  processing_time_ms: number | null;
  created_at: string;
}

export async function createComparison(
  body: DocumentComparisonRequest,
  getToken?: GetTokenFn
): Promise<DocumentComparisonResult> {
  return apiFetch<DocumentComparisonResult>("/comparisons", {
    method: "POST",
    json: body,
    getToken,
  });
}

export async function getComparison(
  comparisonId: string,
  getToken?: GetTokenFn
): Promise<DocumentComparisonResult> {
  return apiFetch<DocumentComparisonResult>(`/comparisons/${comparisonId}`, {
    getToken,
  });
}

export async function listComparisons(
  opts: { workspace_id?: string; limit?: number; offset?: number } = {},
  getToken?: GetTokenFn
): Promise<ComparisonListItem[]> {
  return apiFetch<ComparisonListItem[]>("/comparisons", {
    query: {
      workspace_id: opts.workspace_id,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
    },
    getToken,
  });
}

/**
 * Poll an in-flight comparison until it reaches a terminal state.
 *
 * Backoff strategy: 1s, 2s, 3s, ... capped at 6s, total 90s timeout.
 * The page handler can drive UI updates via the optional `onTick` callback.
 */
export async function pollComparison(
  comparisonId: string,
  opts: {
    onTick?: (result: DocumentComparisonResult, attempt: number) => void;
    getToken?: GetTokenFn;
    timeoutMs?: number;
  } = {}
): Promise<DocumentComparisonResult> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const start = Date.now();
  let attempt = 0;

  while (true) {
    attempt += 1;
    const result = await getComparison(comparisonId, opts.getToken);
    opts.onTick?.(result, attempt);
    if (result.status === "completed" || result.status === "failed") return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Comparison ${comparisonId} did not complete within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, Math.min(1000 + attempt * 500, 6000)));
  }
}
