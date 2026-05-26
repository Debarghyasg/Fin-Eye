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
 */
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Search, CheckSquare, Square, Filter } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadZone } from "@/components/workspace/UploadZone";
import { DocumentCard } from "@/components/workspace/DocumentCard";
import { QueryPanel } from "@/components/workspace/QueryPanel";
import { SourcesPanel } from "@/components/workspace/SourcesPanel";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

export default function WorkspacePage() {
  const documents = useAppStore((s) => s.documents);
  const selectedDocIds = useAppStore((s) => s.selectedDocIds);
  const setSelectedDocIds = useAppStore((s) => s.setSelectedDocIds);
  const clearSelectedDocs = useAppStore((s) => s.clearSelectedDocs);

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
          processingCount > 0
            ? `${indexedCount} indexed · ${processingCount} processing · RAG pipeline active`
            : `${indexedCount} documents indexed · RAG pipeline active`
        }
      />

      <div className="flex flex-1 min-h-0">
        {/* ── Left: document rail ───────────────────────────────────────── */}
        <div className="w-[320px] flex-shrink-0 border-r border-white/[0.07] flex flex-col">
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
        <div className="flex-1 flex flex-col min-w-0">
          <QueryPanel />
        </div>

        {/* ── Right: sources panel ─────────────────────────────────────── */}
        <SourcesPanel />
      </div>
    </div>
  );
}
