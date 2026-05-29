"use client";
import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Sparkles, Copy, ThumbsUp, ThumbsDown, Loader2,
  BookOpen, Filter, X, Trash2,
} from "lucide-react";
import { useAuth } from "@clerk/nextjs";

import { cn, relativeTime, sleep } from "@/lib/utils";
import { useAppStore, type QueryEntry } from "@/store/useAppStore";
import { useWorkspaceId } from "@/lib/use-workspace";
import { IS_LIVE_API } from "@/lib/api/client";
import { submitQuery, type QueryResponse } from "@/lib/api/queries";

const SUGGESTED = [
  "What was total revenue and YoY growth?",
  "Summarize the top 5 risk factors",
  "Compare R&D spend to industry average",
  "What forward guidance did management give?",
  "Identify any material changes in debt obligations",
];

function ConfidencePill({ score }: { score: number }) {
  const color = score >= 0.9 ? "text-emerald-400 bg-emerald-500/10" : score >= 0.75 ? "text-amber-400 bg-amber-500/10" : "text-red-400 bg-red-500/10";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full", color)}>
      <span className="w-1 h-1 rounded-full bg-current" />
      {(score * 100).toFixed(0)}% confidence
    </span>
  );
}

/**
 * Compact in-bubble badge that links to the SourcesPanel — kept so users
 * still see "this answer cited 3 sources" inline. Clicking opens the source
 * in the document viewer (same as clicking it in the right panel).
 */
function InlineSourceLinks({ entry }: { entry: QueryEntry }) {
  const setActiveSource = useAppStore((s) => s.setActiveSource);
  // Resolve ticker/name from the live store so live-mode citations
  // surface real labels (the previous mockDocuments lookup mismatched
  // every real UUID and showed the raw ID instead).
  const documents = useAppStore((s) => s.documents);
  if (entry.sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-1">
      {entry.sources.map((s, i) => {
        const doc = documents.find((d) => d.id === s.docId);
        const label = doc?.ticker ?? doc?.name?.slice(0, 18) ?? s.docId.slice(0, 8);
        return (
          <button
            key={`${s.docId}-${s.page}-${i}`}
            onClick={() => setActiveSource({ docId: s.docId, page: s.page, excerpt: s.excerpt })}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-fin-500/10 border border-fin-500/20 text-fin-300 hover:bg-fin-500/20 transition-colors text-xs"
          >
            <BookOpen className="w-3 h-3" />
            <span className="font-medium">{label}</span>
            <span className="text-muted-foreground">p.{s.page}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Adapt the backend's QueryResponse to the Zustand store's QueryEntry
 * shape. The store keeps a flatter `sources` representation that the
 * SourcesPanel and InlineSourceLinks both consume — keeping that shape
 * stable means we don't have to touch every consumer.
 */
function adaptQueryResponse(r: QueryResponse): QueryEntry {
  return {
    id: r.query_log_id,
    query: r.query,
    answer: r.answer,
    confidence: r.confidence,
    sources: r.sources.map((s) => ({
      docId: s.document_id,
      page: s.page_number ?? 1,
      excerpt: s.excerpt,
    })),
    timestamp: new Date(),
  } as QueryEntry;
}

function QueryBubble({ entry, onDelete }: { entry: QueryEntry; onDelete: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(entry.answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Render bold markdown
  const renderAnswer = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith("**") ? <strong key={i} className="text-foreground font-semibold">{p.slice(2, -2)}</strong> : p
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-3"
    >
      {/* User query */}
      <div className="flex justify-end">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-fin-500/15 border border-fin-500/20 text-sm">
          {entry.query}
        </div>
      </div>

      {/* AI answer */}
      <div className="flex gap-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-fin-400 to-fin-700 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-[0_0_10px_rgba(34,162,105,0.3)]">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="rounded-2xl rounded-tl-sm bg-card border border-white/[0.07] p-4 text-sm text-muted-foreground leading-relaxed">
            {renderAnswer(entry.answer)}
          </div>

          <InlineSourceLinks entry={entry} />

          {/* Actions row */}
          <div className="flex items-center gap-2 px-1">
            <ConfidencePill score={entry.confidence} />
            <span className="text-[10px] text-muted-foreground">{relativeTime(entry.timestamp)}</span>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={copy} className="p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors">
                {copied ? <span className="text-[10px] text-fin-400">Copied!</span> : <Copy className="w-3 h-3" />}
              </button>
              <button className="p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-green-400 transition-colors">
                <ThumbsUp className="w-3 h-3" />
              </button>
              <button className="p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-red-400 transition-colors">
                <ThumbsDown className="w-3 h-3" />
              </button>
              <button
                onClick={() => onDelete(entry.id)}
                aria-label="Delete this message"
                title="Delete this message"
                className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const MOCK_RESPONSES: Record<string, { answer: string; confidence: number }> = {
  default: {
    answer:
      "Based on the indexed documents in your workspace, I found relevant information across **3 sources**. The query matches content in the financial statements and management discussion sections. For more precise results, try specifying a company ticker or fiscal period.",
    confidence: 0.82,
  },
};

/**
 * Build a mock response that respects the multi-select.
 *
 * When the user has selected specific docs, sources are sampled from those
 * docs only — preserves the illusion that the query is scoped to the
 * subset, matching what the live backend will do via document_ids on
 * /api/v1/queries.
 */
function buildMockResponse(query: string, selectedDocIds: string[]): QueryEntry {
  const pool = (selectedDocIds.length > 0 ? selectedDocIds : ["doc-1", "doc-3", "doc-5"]).slice(0, 3);
  return {
    id: `q-${Date.now()}`,
    query,
    answer: MOCK_RESPONSES.default.answer,
    sources: pool.map((docId, i) => ({
      docId,
      page: Math.floor(Math.random() * 80) + 1,
      excerpt:
        i === 0
          ? "Total net sales and operating metrics for the period under review demonstrated continued strength in services revenue."
          : i === 1
            ? "Management discussion and analysis indicates evolving macro headwinds and accelerated AI investment."
            : "Risk factors section was updated to reflect new competitive pressures and supply concentration concerns.",
    })),
    confidence: MOCK_RESPONSES.default.confidence + (Math.random() * 0.1 - 0.05),
    timestamp: new Date(),
  };
}

/**
 * SelectionBar shows what the next query will be scoped to.
 * Sits at the top of the chat panel and is hidden when nothing is selected.
 */
function SelectionBar() {
  const selectedDocIds = useAppStore((s) => s.selectedDocIds);
  const documents = useAppStore((s) => s.documents);
  const clearSelectedDocs = useAppStore((s) => s.clearSelectedDocs);
  const toggleSelectedDoc = useAppStore((s) => s.toggleSelectedDoc);

  if (selectedDocIds.length === 0) return null;
  const selected = documents.filter((d) => selectedDocIds.includes(d.id));

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="border-b border-white/[0.07] bg-fin-500/5 overflow-hidden"
    >
      <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-fin-400 flex-shrink-0" />
        <span className="text-xs text-fin-300 font-medium flex-shrink-0">
          Querying {selected.length} doc{selected.length === 1 ? "" : "s"}:
        </span>
        <div className="flex flex-wrap gap-1 flex-1">
          {selected.map((d) => (
            <button
              key={d.id}
              onClick={() => toggleSelectedDoc(d.id)}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-fin-500/10 border border-fin-500/20 text-[11px] text-fin-300 hover:bg-fin-500/20 transition-colors"
            >
              {d.ticker} · {d.name.length > 24 ? d.name.slice(0, 24) + "…" : d.name}
              <X className="w-2.5 h-2.5" />
            </button>
          ))}
        </div>
        <button
          onClick={clearSelectedDocs}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          Clear
        </button>
      </div>
    </motion.div>
  );
}

export function QueryPanel() {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);
  const queryHistory = useAppStore((s) => s.queryHistory);
  const addQuery = useAppStore((s) => s.addQuery);
  const removeQuery = useAppStore((s) => s.removeQuery);
  const clearQueries = useAppStore((s) => s.clearQueries);
  const isQuerying = useAppStore((s) => s.isQuerying);
  const setIsQuerying = useAppStore((s) => s.setIsQuerying);
  const selectedDocIds = useAppStore((s) => s.selectedDocIds);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Live-mode plumbing: workspace_id + Clerk JWT.
  const { getToken, isSignedIn } = useAuth();
  const workspaceId = useWorkspaceId();
  const liveReady = IS_LIVE_API && !!isSignedIn && !!workspaceId;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [queryHistory.length, isQuerying]);

  const submit = async (q?: string) => {
    const query = (q ?? input).trim();
    if (!query || isQuerying) return;
    setInput("");
    setShowSuggestions(false);
    setIsQuerying(true);

    try {
      if (liveReady) {
        // Real RAG path: hit FastAPI, parse citations, push into store.
        const resp = await submitQuery(
          {
            query,
            workspace_id: workspaceId!,
            // When the user has selected specific docs, scope the retrieval;
            // empty array → backend retrieves across the whole workspace.
            document_ids: selectedDocIds.length ? selectedDocIds : undefined,
          },
          getToken
        );
        addQuery(adaptQueryResponse(resp));
      } else {
        // Offline/mocks: keep the demo behaviour for designers.
        await sleep(1800 + Math.random() * 800);
        addQuery(buildMockResponse(query, selectedDocIds));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[query] submit failed", err);
      // Render a visible failure bubble so the user sees the error rather
      // than thinking the request silently dropped.
      addQuery({
        id: `q-err-${Date.now()}`,
        query,
        answer:
          "**Query failed.** The backend rejected the request — check the browser network tab and the API logs. Common causes: not signed in, no documents indexed yet, or the LLM provider is temporarily unavailable.",
        sources: [],
        confidence: 0,
        timestamp: new Date(),
      } as QueryEntry);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <SelectionBar />

      {/* Conversation toolbar — clear all (only when there's history) */}
      {queryHistory.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.07]">
          <span className="text-[11px] text-muted-foreground">
            {queryHistory.length} message{queryHistory.length === 1 ? "" : "s"}
          </span>
          <button
            onClick={() => clearQueries()}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear all
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0">
        {queryHistory.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center h-full text-center py-12"
          >
            <div className="w-16 h-16 rounded-2xl bg-fin-500/10 border border-fin-500/20 flex items-center justify-center mb-4 animate-float">
              <Sparkles className="w-7 h-7 text-fin-400" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Ask anything about your documents</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Cross-document queries, metric comparisons, risk factor summaries — all with cited page references.
            </p>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {queryHistory.map((entry) => (
            <motion.div
              key={entry.id}
              layout
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.2 }}
            >
              <QueryBubble entry={entry} onDelete={removeQuery} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        <AnimatePresence>
          {isQuerying && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex gap-3"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-fin-400 to-fin-700 flex items-center justify-center flex-shrink-0 shadow-[0_0_10px_rgba(34,162,105,0.3)]">
                <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-card border border-white/[0.07]">
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-fin-400 loading-dot" />
                  <div className="w-1.5 h-1.5 rounded-full bg-fin-400 loading-dot" />
                  <div className="w-1.5 h-1.5 rounded-full bg-fin-400 loading-dot" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Retrieving · Re-ranking · Generating…</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Suggestions */}
      <AnimatePresence>
        {showSuggestions && queryHistory.length <= 2 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 pb-2"
          >
            <p className="text-xs text-muted-foreground mb-2">Suggested queries</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="text-xs px-2.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-muted-foreground hover:bg-fin-500/10 hover:border-fin-500/30 hover:text-fin-300 transition-all duration-200"
                >
                  {s}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input */}
      <div className="p-4 border-t border-white/[0.07]">
        <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-2 focus-within:border-fin-500/40 focus-within:bg-white/[0.06] transition-all duration-200">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={handleKey}
            placeholder={
              selectedDocIds.length > 0
                ? `Ask across ${selectedDocIds.length} selected doc${selectedDocIds.length === 1 ? "" : "s"}…`
                : "Ask a question across your documents… (⏎ to send)"
            }
            className="flex-1 bg-transparent resize-none text-sm placeholder:text-muted-foreground focus:outline-none max-h-[120px] leading-relaxed py-1"
            style={{ height: "36px" }}
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => submit()}
            disabled={!input.trim() || isQuerying}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200",
              input.trim() && !isQuerying
                ? "bg-fin-500 text-white shadow-[0_0_12px_rgba(34,162,105,0.4)] hover:bg-fin-400"
                : "bg-white/[0.06] text-muted-foreground"
            )}
          >
            <Send className="w-3.5 h-3.5" />
          </motion.button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          Hybrid BM25 + vector search · Cross-encoder re-ranking · GPT-4o
        </p>
      </div>
    </div>
  );
}
