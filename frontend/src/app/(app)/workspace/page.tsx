"use client";
/**
 * Workspace page — Phase 4 Week 7 Day 1-4.
 *
 * Three-column layout:
 *   ┌──────────────┬─────────────────────┬──────────────┐
 *   │ Document      │ Chat / query panel  │ Sources       │
 *   │ rail (320px)  │ (flex-1)            │ panel (380px) │
 *   └──────────────┴─────────────────────┴──────────────┘
 *
 * The left rail supports multi-select (checkbox per card) so the
 * QueryPanel can scope its query to a subset of docs. The right panel
 * surfaces the cited chunks of the most recent answer; clicking a source
 * sets `activeSource` which the next commit's <DocumentViewer /> dialog
 * consumes to open the PDF on the right page with the excerpt
 * highlighted.
 *
 * In live mode (NEXT_PUBLIC_API_URL set), the document list and query
 * history are seeded from the backend on mount; subsequent
 * uploads/queries mutate the same store so the UI stays in sync without
 * a refetch on every keystroke.
 */
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Search, CheckSquare, Square, Filter, BookOpen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadZone } from "@/components/workspace/UploadZone";
import { DocumentCard } from "@/components/workspace/DocumentCard";
import { QueryPanel } from "@/components/workspace/QueryPanel";
import { SourcesPanel } from "@/components/workspace/SourcesPanel";
import { useAppStore, type Document, type QueryEntry } from "@/store/useAppStore";
import { useWorkspaceId } from "@/lib/use-workspace";
import { IS_LIVE_API } from "@/lib/api/client";
import {
  listDocuments,
  type DocumentOut,
  type DocumentStatus,
} from "@/lib/api/documents";
import { getQueryHistory, type QueryHistoryItem } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

/**
 * Map the backend's ``DocumentOut`` (snake_case, raw enum values) to the
 * Zustand store's ``Document`` shape (camelCase, UI-friendly labels). Keeps
 * every consumer of the store unchanged — DocumentCard, SourcesPanel, etc.
 * all keep working.
 */
function adaptDocument(d: DocumentOut): Document {
  const typeLabel: Document["type"] =
    d.doc_type === "10-K"
      ? "10-K"
      : d.doc_type === "10-Q"
        ? "10-Q"
        : d.doc_type === "earnings_call"
          ? "Earnings Call"
          : d.doc_type === "annual_report"
            ? "Annual Report"
            : d.doc_type === "prospectus"
              ? "Prospectus"
              : "Other";

  const uiStatus: Document["status"] =
    d.status === "indexed"
      ? "indexed"
      : d.status === "failed"
        ? ("failed" as Document["status"])
        : "processing";

  return {
    id: d.id,
    name: d.original_filename,
    type: typeLabel,
    company: d.company_name ?? "—",
    ticker: d.ticker ?? "—",
    size: d.file_size_bytes,
    pages: d.page_count ?? 0,
    chunkCount: 0, // populated by the upload poller; full count needs /chunks
    uploadedAt: new Date(d.created_at),
    status: uiStatus,
    tags: [d.fiscal_period ?? "uploaded"].filter(Boolean) as string[],
    confidence: d.avg_confidence ?? 0,
    processingProgress: uiStatus === "indexed" ? 100 : 50,
  } as Document;
}

/**
 * Map ``QueryHistoryItem`` (one Postgres row) to the store's ``QueryEntry``
 * shape used by QueryPanel / SourcesPanel.
 */
function adaptQueryHistoryItem(h: QueryHistoryItem): QueryEntry {
  // source_chunk_ids/source_doc_ids are JSON-encoded strings — best-effort
  // parse, ignore malformed entries (older rows may pre-date the encoding).
  let chunkIds: string[] = [];
  let docIds: string[] = [];
  try {
    if (h.source_chunk_ids) chunkIds = JSON.parse(h.source_chunk_ids);
  } catch {}
  try {
    if (h.source_doc_ids) docIds = JSON.parse(h.source_doc_ids);
  } catch {}

  return {
    id: h.id,
    query: h.query_text,
    answer: h.answer_text ?? "",
    sources: docIds.slice(0, 5).map((docId, i) => ({
      docId,
      page: 1,
      excerpt: chunkIds[i] ? `Chunk ${chunkIds[i].slice(0, 8)}…` : "",
    })),
    confidence: h.confidence_score ?? 0,
    timestamp: new Date(h.created_at),
  } as QueryEntry;
}

export default function WorkspacePage() {
  const documents = useAppStore((s) => s.documents);
  const selectedDocIds = useAppStore((s) => s.selectedDocIds);
  const setSelectedDocIds = useAppStore((s) => s.setSelectedDocIds);
  const clearSelectedDocs = useAppStore((s) => s.clearSelectedDocs);
  const sourcesPanelOpen = useAppStore((s) => s.sourcesPanelOpen);
  const setSourcesPanelOpen = useAppStore((s) => s.setSourcesPanelOpen);

  // ── Live-mode hydration ─────────────────────────────────────────────
  // Pull the user's documents and query history from the backend so the
  // UI doesn't show only the in-memory items added during this session.
  const { getToken, isSignedIn } = useAuth();
  const workspaceId = useWorkspaceId();
  const liveReady = IS_LIVE_API && !!isSignedIn && !!workspaceId;

  const docsQuery = useQuery({
    queryKey: ["documents", workspaceId],
    queryFn: () => listDocuments(workspaceId!, { page_size: 100 }, getToken),
    enabled: liveReady,
    staleTime: 30_000,
  });

  const historyQuery = useQuery({
    queryKey: ["query-history", workspaceId],
    queryFn: () => getQueryHistory(workspaceId!, { page_size: 20 }, getToken),
    enabled: liveReady,
    staleTime: 30_000,
  });

  // Hydrate the Zustand store from the React Query caches. We only do
  // this when fresh server data arrives — this means in-flight uploads
  // and queries that mutate the store directly are preserved between
  // server fetches (the store is the single source of truth for the UI).
  useEffect(() => {
    if (!liveReady) return;
    if (!docsQuery.data) return;
    const adapted = docsQuery.data.items.map(adaptDocument);
    // Preserve any in-flight uploads (status === "processing" with a
    // non-server ID) that the server hasn't yet returned.
    const serverIds = new Set(adapted.map((d) => d.id));
    const inFlight = useAppStore
      .getState()
      .documents.filter((d) => !serverIds.has(d.id) && d.status !== "indexed");
    useAppStore.setState({ documents: [...inFlight, ...adapted] });
  }, [liveReady, docsQuery.data]);

  useEffect(() => {
    if (!liveReady) return;
    if (!historyQuery.data) return;
    const adapted = historyQuery.data.items.map(adaptQueryHistoryItem);
    useAppStore.setState({ queryHistory: adapted });
  }, [liveReady, historyQuery.data]);

  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "indexed" | "processing">("all");

  // Apply text filter + status filter
  const filtered = documents.filter((d) => {
    if (filterStatus !== "all" && d.status !== filterStatus) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      d.company.toLowerCase().includes(q) ||
      d.ticker.toLowerCase().includes(q)
    );
  });

  const indexedFiltered = filtered.filter((d) => d.status === "indexed");
  const allFilteredSelected =
    indexedFiltered.length > 0 &&
    indexedFiltered.every((d) => selectedDocIds.includes(d.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      clearSelectedDocs();
    } else {
      setSelectedDocIds(indexedFiltered.map((d) => d.id));
    }
  };

  const indexedCount = documents.filter((d) => d.status === "indexed").length;
  const processingCount = documents.filter((d) => d.status === "processing").length;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Document Workspace"
        subtitle={
          liveReady && docsQuery.isLoading
            ? "Loading documents from backend…"
            : processingCount > 0
              ? `${indexedCount} indexed · ${processingCount} processing · RAG pipeline active`
              : `${indexedCount} documents indexed · RAG pipeline active`
        }
      />

      <div className="flex flex-1 min-h-0">
        {/* ── Left: document rail ───────────────────────────────────────── */}
        <div className="w-[260px] xl:w-[320px] flex-shrink-0 border-r border-white/[0.07] flex flex-col">
          {/* Toolbar */}
          <div className="p-4 space-y-3 border-b border-white/[0.07]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search documents…"
                className="pl-9 h-8 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Status filter pills */}
            <div className="flex items-center gap-1">
              {(["all", "indexed", "processing"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded-md font-medium transition-colors capitalize",
                    filterStatus === s
                      ? "bg-fin-500/15 text-fin-300"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}
                >
                  {s}
                  {s === "indexed" && indexedCount > 0 && (
                    <span className="ml-1 text-[9px] opacity-70">{indexedCount}</span>
                  )}
                  {s === "processing" && processingCount > 0 && (
                    <span className="ml-1 text-[9px] opacity-70">{processingCount}</span>
                  )}
                </button>
              ))}
            </div>

            <Button
              variant="glow"
              size="sm"
              className="w-full gap-2"
              onClick={() => setShowUpload(!showUpload)}
            >
              <Plus className="w-4 h-4" />
              Upload Documents
            </Button>
          </div>

          {/* Upload zone */}
          <AnimatePresence>
            {showUpload && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-b border-white/[0.07]"
              >
                <div className="p-4">
                  <UploadZone />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Multi-select toggle bar */}
          {indexedFiltered.length > 0 && (
            <div className="px-3 py-2 border-b border-white/[0.07] flex items-center justify-between">
              <button
                onClick={toggleSelectAll}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {allFilteredSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-fin-400" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
                {allFilteredSelected ? "Deselect all" : "Select all for query"}
              </button>
              {selectedDocIds.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] text-fin-300 bg-fin-500/10 px-1.5 py-0.5 rounded-full font-medium">
                  <Filter className="w-2.5 h-2.5" />
                  {selectedDocIds.length} selected
                </span>
              )}
            </div>
          )}

          {/* Document list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <AnimatePresence>
              {filtered.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-12 text-muted-foreground text-sm"
                >
                  No documents found
                </motion.div>
              ) : (
                filtered.map((doc, i) => (
                  <motion.div
                    key={doc.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <DocumentCard
                      doc={doc}
                      selectable={doc.status === "indexed"}
                    />
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Center: chat / query panel ───────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          <QueryPanel />

          {/* Floating "show sources" toggle — visible only when the panel is
              hidden, so the user can always bring the citations back. */}
          {!sourcesPanelOpen && (
            <button
              onClick={() => setSourcesPanelOpen(true)}
              aria-label="Show sources panel"
              title="Show sources"
              className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-card/90 backdrop-blur text-xs text-muted-foreground hover:text-foreground hover:border-fin-500/40 transition-colors shadow-lg"
            >
              <BookOpen className="w-3.5 h-3.5 text-fin-400" />
              Sources
            </button>
          )}
        </div>

        {/* ── Right: sources panel (collapsible) ───────────────────────── */}
        {sourcesPanelOpen && <SourcesPanel />}
      </div>
    </div>
  );
}
