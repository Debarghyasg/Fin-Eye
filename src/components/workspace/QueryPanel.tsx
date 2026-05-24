"use client";
import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Sparkles, BookOpen, ChevronDown, ChevronUp,
  Copy, ThumbsUp, ThumbsDown, ExternalLink, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, relativeTime, sleep } from "@/lib/utils";
import { useAppStore, type QueryEntry } from "@/store/useAppStore";
import { mockQueryHistory, mockDocuments } from "@/lib/mock-data";

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

function SourceChip({ docId, page, excerpt }: { docId: string; page: number; excerpt: string }) {
  const doc = mockDocuments.find((d) => d.id === docId);
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-fin-500/10 border border-fin-500/20 text-fin-300 hover:bg-fin-500/20 transition-colors"
      >
        <BookOpen className="w-3 h-3" />
        <span className="font-medium">{doc?.ticker ?? docId}</span>
        <span className="text-muted-foreground">p.{page}</span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1 p-2 rounded-md bg-white/[0.04] border border-white/[0.07] text-muted-foreground italic">
              "{excerpt}"
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function QueryBubble({ entry }: { entry: QueryEntry }) {
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

          {/* Sources */}
          {entry.sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {entry.sources.map((s, i) => (
                <SourceChip key={i} {...s} />
              ))}
            </div>
          )}

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
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const MOCK_RESPONSES: Record<string, { answer: string; confidence: number }> = {
  default: {
    answer: "Based on the indexed documents in your workspace, I found relevant information across **3 sources**. The query matches content in the financial statements and management discussion sections. For more precise results, try specifying a company ticker or fiscal period.",
    confidence: 0.82,
  },
};

export function QueryPanel() {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);
  const { queryHistory, addQuery, isQuerying, setIsQuerying } = useAppStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    await sleep(1800 + Math.random() * 800);
    const resp = MOCK_RESPONSES.default;
    addQuery({
      id: `q-${Date.now()}`,
      query,
      answer: resp.answer,
      sources: [
        { docId: "doc-1", page: Math.floor(Math.random() * 80) + 1, excerpt: "Total net sales and operating metrics…" },
        { docId: "doc-3", page: Math.floor(Math.random() * 200) + 1, excerpt: "Management discussion and analysis…" },
      ],
      confidence: resp.confidence + (Math.random() * 0.1 - 0.05),
      timestamp: new Date(),
    });
    setIsQuerying(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex flex-col h-full">
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

        {queryHistory.map((entry) => (
          <QueryBubble key={entry.id} entry={entry} />
        ))}

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
            placeholder="Ask a question across your documents… (⏎ to send)"
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
