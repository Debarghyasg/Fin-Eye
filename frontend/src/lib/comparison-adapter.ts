/**
 * Comparison-page data adapter — Phase 4 Week 8 Day 1-3.
 *
 * The Compare page started as a mock-driven UI with one shape; the live
 * Phase 3 backend (`POST /api/v1/comparisons`) returns a richer-but-
 * differently-shaped payload (see backend/app/db/schemas.py:
 * DocumentComparisonResult). This module is the single point where we
 * normalise both shapes into one UI-friendly view model so the page
 * itself can stay shape-agnostic.
 *
 * Mock shape: lib/mock-data.ts → mockComparisonData
 * Live shape: lib/api/comparisons.ts → DocumentComparisonResult
 */
import type {
  DocumentComparisonResult,
  FinancialMetricComparison,
} from "@/lib/api/comparisons";
import { mockComparisonData } from "@/lib/mock-data";

export type Direction = "up" | "down" | "flat";

export interface NormalisedDoc {
  id: string;
  name: string;
  company: string | null;
  ticker: string | null;
  period: string | null;
}

export interface NormalisedMetric {
  name: string;          // human-friendly label e.g. "Revenue"
  metricKey: string;     // raw key e.g. "revenue"
  valueA: string;        // formatted display value e.g. "$394.3B"
  valueB: string;
  /** percentage change (signed). null if unknowable. */
  delta: number | null;
  direction: Direction;
  significance: "major" | "moderate" | "minor" | "negligible" | "unknown";
}

export interface NormalisedRiskChange {
  type: "new" | "expanded" | "removed" | "modified";
  text: string;
}

export interface NormalisedSentiment {
  /** "positive" probability for period A (0..1). */
  scoreA: number;
  scoreB: number;
  /** scoreB - scoreA */
  delta: number;
  interpretation?: string;
  significance?: "major" | "moderate" | "minor" | "negligible";
}

export interface NormalisedComparison {
  comparisonId: string | null;
  status: "idle" | "processing" | "completed" | "failed";
  documentA: NormalisedDoc;
  documentB: NormalisedDoc;
  metrics: NormalisedMetric[];
  riskChanges: NormalisedRiskChange[];
  sentiment: NormalisedSentiment | null;
  /**
   * Either a single LLM-authored block (live API) or a list of
   * structured sections (mock data).
   */
  narrative:
    | { type: "single"; body: string }
    | { type: "sections"; items: Array<{ title: string; body: string }> }
    | null;
  processingTimeMs: number | null;
  errorMessage: string | null;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */
const METRIC_LABELS: Record<string, string> = {
  revenue: "Total Revenue",
  net_income: "Net Income",
  eps_basic: "Basic EPS",
  eps_diluted: "Diluted EPS",
  gross_margin: "Gross Margin",
  operating_expenses: "Total OpEx",
  rd_expenses: "R&D Expense",
  sales_marketing: "Sales & Marketing",
  general_admin: "G&A Expense",
};

/** True for keys that are percentages, not currency values. */
const PERCENT_METRIC_KEYS = new Set(["gross_margin"]);

/** True for keys that are dollars-per-share, formatted differently. */
const PER_SHARE_METRIC_KEYS = new Set(["eps_basic", "eps_diluted"]);

function formatMetricValue(key: string, value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  if (PERCENT_METRIC_KEYS.has(key)) {
    return `${value.toFixed(1)}%`;
  }

  if (PER_SHARE_METRIC_KEYS.has(key)) {
    return `$${value.toFixed(2)}`;
  }

  // The backend reports monetary values in millions. Scale up.
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}T`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}B`;
  if (abs >= 1) return `$${value.toFixed(0)}M`;
  return `$${(value * 1000).toFixed(0)}K`;
}

function classifyDelta(direction: string, delta: number | null): Direction {
  if (delta !== null && Math.abs(delta) < 0.5) return "flat";
  if (direction === "increase") return "up";
  if (direction === "decrease") return "down";
  return "flat";
}

/**
 * Build a human-readable line for a risk-factor change.
 *
 * Models are inconsistent about which field carries the text: sometimes it's
 * `description`, sometimes only `category` is filled. Previously we read
 * `description` directly, so a blank description rendered a "NEW" badge with
 * no text. Prefer `description`, fall back to `category`, and combine them
 * when both add signal.
 */
function riskText(
  r: { category?: string | null; description?: string | null } | string
): string {
  if (typeof r === "string") return r.trim();
  if (!r || typeof r !== "object") return "";
  const desc = (r.description ?? "").trim();
  const cat = (r.category ?? "").trim();
  if (desc && cat && desc.toLowerCase() !== cat.toLowerCase()) return `${cat}: ${desc}`;
  return desc || cat || "";
}

/* ── Live API → normalised ──────────────────────────────────────────────── */
function adaptLiveMetric(m: FinancialMetricComparison): NormalisedMetric {
  return {
    metricKey: m.metric_name,
    name: METRIC_LABELS[m.metric_name] ?? m.metric_name.replace(/_/g, " "),
    valueA: formatMetricValue(m.metric_name, m.old_value),
    valueB: formatMetricValue(m.metric_name, m.new_value),
    delta: m.percentage_change,
    direction: classifyDelta(m.direction, m.percentage_change),
    significance: m.significance,
  };
}

export function adaptLiveComparison(
  result: DocumentComparisonResult
): NormalisedComparison {
  const docA = result.documents.document_a;
  const docB = result.documents.document_b;

  // Risk factor changes — live API only emits "added" + "removed",
  // we widen them into our four-type union for UI parity.
  const riskChanges: NormalisedRiskChange[] = [];
  const rfc = result.risk_factor_changes;
  if (rfc) {
    rfc.added?.forEach((r) => {
      const text = riskText(r);
      if (text) riskChanges.push({ type: "new", text });
    });
    rfc.removed?.forEach((r) => {
      const text = riskText(r);
      if (text) riskChanges.push({ type: "removed", text });
    });
  }

  // Sentiment — live API has more structure; collapse to the page's view
  let sentiment: NormalisedSentiment | null = null;
  const sa = result.sentiment_analysis;
  if (sa && sa.period_a_sentiment && sa.period_b_sentiment) {
    sentiment = {
      scoreA: sa.period_a_sentiment.positive,
      scoreB: sa.period_b_sentiment.positive,
      delta: sa.period_b_sentiment.positive - sa.period_a_sentiment.positive,
      interpretation: sa.interpretation,
      significance: sa.sentiment_shift?.significance,
    };
  }

  const narrative = result.narrative_summary
    ? { type: "single" as const, body: result.narrative_summary }
    : null;

  return {
    comparisonId: result.comparison_id,
    status: result.status,
    documentA: {
      id: docA.id,
      name: docA.filename,
      company: docA.company,
      ticker: docA.ticker,
      period: docA.period,
    },
    documentB: {
      id: docB.id,
      name: docB.filename,
      company: docB.company,
      ticker: docB.ticker,
      period: docB.period,
    },
    metrics: result.financial_metrics.map(adaptLiveMetric),
    riskChanges,
    sentiment,
    narrative,
    processingTimeMs: result.processing_time_ms,
    errorMessage: result.error_message,
  };
}

/* ── Mock → normalised ──────────────────────────────────────────────────── */
type MockShape = typeof mockComparisonData;

export function adaptMockComparison(
  data: MockShape = mockComparisonData
): NormalisedComparison {
  const metrics: NormalisedMetric[] = data.metrics.map((m) => ({
    metricKey: m.label.toLowerCase().replace(/\s+/g, "_"),
    name: m.label,
    valueA: m.valueA,
    valueB: m.valueB,
    delta: m.delta,
    direction: Math.abs(m.delta) < 0.5 ? "flat" : m.direction,
    significance:
      Math.abs(m.delta) >= 50
        ? "major"
        : Math.abs(m.delta) >= 20
          ? "moderate"
          : Math.abs(m.delta) >= 5
            ? "minor"
            : "negligible",
  }));

  const riskChanges: NormalisedRiskChange[] = data.riskChanges.map((r) => ({
    type: r.type,
    text: r.text,
  }));

  const sentiment: NormalisedSentiment = {
    scoreA: data.sentimentShift.score2022,
    scoreB: data.sentimentShift.score2023,
    delta: data.sentimentShift.change,
    interpretation:
      data.sentimentShift.change < 0
        ? "Management tone has shifted toward increased caution. Guidance language uses more hedging terms (+23%) and uncertainty qualifiers compared to the prior year filing."
        : "Management tone reflects increased confidence. Forward-looking statements use more affirmative language compared to the prior year.",
    significance:
      Math.abs(data.sentimentShift.change) >= 0.2
        ? "major"
        : Math.abs(data.sentimentShift.change) >= 0.1
          ? "moderate"
          : Math.abs(data.sentimentShift.change) >= 0.05
            ? "minor"
            : "negligible",
  };

  // Mock has structured narrative sections — keep them for visual parity
  // with the existing UI (even though the live API returns a single block)
  const narrative: NormalisedComparison["narrative"] = {
    type: "sections",
    items: [
      {
        title: "Revenue & Profitability",
        body: "Apple's FY2023 results reflect a modest revenue contraction of 2.8% ($383.3B vs $394.3B), driven primarily by hardware headwinds in iPhone and Mac segments. However, gross margin expanded 80bps to 44.1%, suggesting improving product mix and cost discipline. Services revenue reached a record $85.2B, growing 9.1% YoY and now representing 22.2% of total revenue — up from 19.8% in FY2022. This structural shift toward high-margin recurring revenue is a material positive for long-term earnings quality.",
      },
      {
        title: "Capital Allocation",
        body: "Free cash flow declined 6.7% to $99.6B, partly due to the 13.7% increase in R&D expenditure ($29.9B). The company returned $89.3B to shareholders via buybacks and dividends. The elevated R&D spend appears correlated with accelerated investments in silicon (M-series chips, Vision Pro), generative AI capabilities, and health technology — positioning that should create defensible competitive advantages, consistent with the new risk factor language added around AI competition.",
      },
      {
        title: "Risk Profile Evolution",
        body: "The risk factor section underwent four material changes. The introduction of a generative AI competition risk factor is particularly notable — Apple explicitly acknowledges that third-party AI integration into its platforms creates competitive uncertainty. The expansion of TSMC dependency language (+34%) reflects ongoing supply concentration concerns despite diversification efforts. The removal of COVID-19 from primary risks marks a normalization of operational conditions. Net risk posture is slightly elevated versus FY2022, consistent with the decline in management sentiment scores.",
      },
    ],
  };

  return {
    comparisonId: "mock-comparison",
    status: "completed",
    documentA: {
      id: data.docA.id,
      name: data.docA.name,
      company: data.docA.company,
      ticker: "AAPL",
      period: data.docA.period,
    },
    documentB: {
      id: data.docB.id,
      name: data.docB.name,
      company: data.docB.company,
      ticker: "AAPL",
      period: data.docB.period,
    },
    metrics,
    riskChanges,
    sentiment,
    narrative,
    processingTimeMs: 2148,
    errorMessage: null,
  };
}
