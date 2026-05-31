"use client";
/**
 * Sources Panel — Phase 4 Week 7 Day 3-4.
 *
 * The right column of the workspace page. When a query response arrives,
 * this panel shows the exact chunks that were cited — document name,
 * page number, ranked relevance, and the excerpted text.
 *
 * Clicking a source sets `activeSource` in the store, which the next
 * commit's DocumentViewer dialog consumes to open the PDF on that page
 * with the excerpt highlighted.
 *
 * The panel pulls from the most recent entry in `queryHistory` so it
 * automatically refreshes when a new query completes.
 */
import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, FileText, ExternalLink, Sparkles, Hash,
  TrendingUp, Loader2, ChevronRight, PanelRightClose,
} from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useTranslation } from "@/lib/i18n";

function ConfidenceBadge({ score }: { score: number }) {
  const color =
    score >= 0.9
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : score >= 0.75
        ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
        : "text-red-400 bg-red-500/10 border-red-500/20";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border",
        color
      )}
    >
      <span className="w-1 h-1 rounded-full bg-current" />
      {(score * 100).toFixed(0)}%
    </span>
  );
}

interface SourcesPanelProps {
  /** When true, renders a compact loading state. */
  loading?: boolean;
}

export function SourcesPanel({ loading = false }: SourcesPanelProps) {
  const { t } = useTranslation();
  const queryHistory = useAppStore((s) => s.queryHistory);
  const documents = useAppStore((s) => s.documents);
  const setActiveSource = useAppStore((s) => s.setActiveSource);
  const isQuerying = useAppStore((s) => s.isQuerying);
  const setSourcesPanelOpen = useAppStore((s) => s.setSourcesPanelOpen);

  // Most recent query result drives the panel
  const latest = queryHistory[0];

  const enriched = useMemo(() => {
    if (!latest) return [];
    return latest.sources.map((src, idx) => {
      const doc = documents.find((d) => d.id === src.docId);
      return {
        index: idx + 1,
        ...src,
        ticker: doc?.ticker ?? "",
        docName: doc?.name ?? src.docId,
        company: doc?.company ?? "",
        type: doc?.type ?? "",
      };
    });
  }, [latest, documents]);

  const showLoading = loading || isQuerying;

  return (
    <aside className="w-[300px] xl:w-[380px] flex-shrink-0 border-l border-white/[0.07] bg-card/40 flex flex-col h-full">
      {/* Header */}
      <div className="px-4 h-12 border-b border-white/[0.07] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-fin-500/10 flex items-center justify-center">
            <BookOpen className="w-3.5 h-3.5 text-fin-400" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">{t("sources.title")}</p>
            <p className="text-[10px] text-muted-foreground">
              {showLoading
                ? t("sources.retrieving")
                : enriched.length > 0
                  ? (() => {
                      const docCount = new Set(enriched.map((e) => e.docId)).size;
                      return docCount === 1
                        ? t("sources.citedFromOne", { count: enriched.length, docs: docCount })
                        : t("sources.citedFromOther", { count: enriched.length, docs: docCount });
                    })()
                  : t("sources.ready")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {latest && !showLoading && (
            <span className="text-[10px] text-muted-foreground">
              {relativeTime(latest.timestamp)}
            </span>
          )}
          <button
            onClick={() => setSourcesPanelOpen(false)}
            aria-label={t("sources.hidePanel")}
            title={t("sources.hidePanel")}
            className="w-6 h-6 rounded-md hover:bg-white/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        <AnimatePresence mode="wait">
          {showLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 animate-pulse"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.05]" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-2.5 w-2/3 bg-white/[0.05] rounded" />
                      <div className="h-2 w-1/3 bg-white/[0.04] rounded" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 w-full bg-white/[0.04] rounded" />
                    <div className="h-2 w-5/6 bg-white/[0.04] rounded" />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-center gap-2 pt-3">
                <Loader2 className="w-3 h-3 animate-spin text-fin-400" />
                <p className="text-xs text-muted-foreground">
                  {t("sources.hybridRerank")}
                </p>
              </div>
            </motion.div>
          ) : enriched.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center text-center pt-12 px-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-fin-500/10 border border-fin-500/20 flex items-center justify-center mb-3">
                <Sparkles className="w-5 h-5 text-fin-400" />
              </div>
              <h4 className="text-sm font-semibold mb-1">{t("sources.emptyTitle")}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("sources.emptyDesc")}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="sources"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2.5"
            >
              {/* Optional: query echo at the top */}
              {latest && (
                <div className="px-3 py-2 rounded-lg bg-fin-500/5 border border-fin-500/15 mb-3">
                  <p className="text-[10px] uppercase tracking-wide text-fin-400 font-semibold mb-1">
                    {t("sources.query")}
                  </p>
                  <p className="text-xs text-foreground line-clamp-3">{latest.query}</p>
                </div>
              )}

              {enriched.map((src, i) => (
                <motion.button
                  key={`${src.docId}-${src.page}-${i}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  onClick={() =>
                    setActiveSource({
                      docId: src.docId,
                      page: src.page,
                      excerpt: src.excerpt,
                    })
                  }
                  className="group w-full text-left rounded-xl border border-white/[0.07] bg-card hover:border-fin-500/30 hover:bg-fin-500/5 p-3 transition-all"
                >
                  {/* Header row */}
                  <div className="flex items-start gap-2.5 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-fin-500/10 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-fin-300">
                      {src.index}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        <p className="text-xs font-semibold truncate">
                          {src.ticker ? `${src.ticker} · ` : ""}
                          {src.docName}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="inline-flex items-center gap-0.5">
                          <Hash className="w-2.5 h-2.5" />
                          {t("sources.page", { page: src.page })}
                        </span>
                        
                        {(src as any).score > 0 && (
  <>
    <span className="text-white/20">·</span>
    <span className="inline-flex items-center gap-0.5">
      <TrendingUp className="w-2.5 h-2.5" />
      {t("sources.match", { pct: ((src as any).score * 100).toFixed(0) })}
    </span>
  </>
)}

                      </div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 group-hover:text-fin-400 transition-all" />
                  </div>

                  {/* Excerpt */}
                  <p className="text-xs text-muted-foreground leading-relaxed italic line-clamp-3 pl-9">
                    "{src.excerpt}"
                  </p>
                </motion.button>
              ))}

              {/* Confidence footer */}
              {latest && (
                <div className="flex items-center justify-between mt-3 px-1">
                  <span className="text-[10px] text-muted-foreground">
                    {t("sources.answerConfidence")}
                  </span>
                  <ConfidenceBadge score={latest.confidence} />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-3 py-2.5 border-t border-white/[0.07] bg-card/40 flex-shrink-0">
        <p className="text-[10px] text-muted-foreground text-center">
          {t("sources.footerHint")}
        </p>
      </div>
    </aside>
  );
}
