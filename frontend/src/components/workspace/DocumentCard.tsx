"use client";
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Trash2, MoreVertical, ExternalLink,
  CheckCircle2, Loader2, Clock, Tag, Database, Check,
  Pencil,
} from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { cn, formatBytes, relativeTime } from "@/lib/utils";
import type { Document } from "@/store/useAppStore";
import { useAppStore } from "@/store/useAppStore";
import { IS_LIVE_API } from "@/lib/api/client";
import {
  deleteDocument as apiDeleteDocument,
  getDocumentFileUrl,
} from "@/lib/api/documents";
import { ChunksDialog } from "./ChunksDialog";
import { EditDocumentDialog } from "./EditDocumentDialog";

const statusConfig = {
  indexed: { label: "Indexed", icon: CheckCircle2, color: "text-emerald-400" },
  processing: { label: "Processing", icon: Loader2, color: "text-violet-400" },
  failed: { label: "Failed", icon: Clock, color: "text-red-400" },
};

export interface DocumentCardProps {
  doc: Document;
  /** Click handler for the main card body — typically opens the viewer or activates the doc. */
  onClick?: () => void;
  /** Whether this doc is the "active" one (e.g. opened in viewer). */
  active?: boolean;
  /**
   * When true, render a checkbox in the top-right corner that toggles
   * the doc's membership in `selectedDocIds`. When false, just show the
   * row without a checkbox.
   */
  selectable?: boolean;
}

/**
 * Compact list-style card for a document in the workspace left rail.
 *
 * Phase 4 additions:
 *   - Chunk count shown next to page count when the doc is indexed
 *   - Real progress bar during the "processing" stage (driven by
 *     `processingProgress` 0-100)
 *   - Optional multi-select checkbox that toggles the doc in
 *     `selectedDocIds` so the QueryPanel can scope queries to a subset
 *
 * Wiring (audit follow-up):
 *   - "Delete" hits the real DELETE /documents/{id} endpoint when
 *     IS_LIVE_API is on, then updates the store. Mock mode still
 *     short-circuits to the in-memory remove.
 *   - "Edit metadata" opens EditDocumentDialog, which calls
 *     PATCH /documents/{id}.
 *   - "View chunks" opens ChunksDialog, which calls
 *     GET /documents/{id}/chunks.
 *   - "View PDF" opens GET /documents/{id}/file in a new tab when live;
 *     otherwise it activates the doc so the existing mock viewer can
 *     render the placeholder page.
 */
export function DocumentCard({ doc, onClick, active = false, selectable = false }: DocumentCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [chunksOpen, setChunksOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const removeDocument = useAppStore((s) => s.removeDocument);
  const setActiveSource = useAppStore((s) => s.setActiveSource);
  const selectedDocIds = useAppStore((s) => s.selectedDocIds);
  const toggleSelectedDoc = useAppStore((s) => s.toggleSelectedDoc);
  const isSelected = selectedDocIds.includes(doc.id);

  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const cfg = statusConfig[doc.status as keyof typeof statusConfig] || statusConfig.processing;
  const StatusIcon = cfg.icon;
  const isProcessing = doc.status === "processing";
  const processingPct = doc.processingProgress ?? 0;

  const handleDelete = async () => {
    setMenuOpen(false);

    // Live mode: call the backend first so Postgres + S3 + Qdrant all
    // drop the document. Only after the API succeeds do we touch the
    // store, otherwise a 404 in the FE could mask a real backend error.
    if (IS_LIVE_API) {
      // eslint-disable-next-line no-alert
      const confirmed = window.confirm(
        `Delete "${doc.name}"? This removes it from the database, object storage and the vector index.`
      );
      if (!confirmed) return;

      setDeleting(true);
      try {
        await apiDeleteDocument(doc.id, getToken);
        removeDocument(doc.id);
        queryClient.invalidateQueries({ queryKey: ["documents"] });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[DocumentCard] delete failed", err);
        // eslint-disable-next-line no-alert
        window.alert(
          `Could not delete this document: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      } finally {
        setDeleting(false);
      }
      return;
    }

    // Mock mode: just drop it from the store.
    removeDocument(doc.id);
  };

  const handleViewPdf = () => {
    setMenuOpen(false);
    if (IS_LIVE_API) {
      // Open the raw bytes in a new tab. The /file endpoint defaults to
      // inline disposition so the browser PDF viewer renders directly.
      window.open(getDocumentFileUrl(doc.id), "_blank", "noopener,noreferrer");
    } else {
      // Mock fallback: activate the in-app viewer with a synthetic source.
      setActiveSource({
        docId: doc.id,
        page: 1,
        excerpt: "Open the document at page 1 (mock viewer).",
      });
    }
  };

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        whileHover={{ y: -1 }}
        onClick={onClick}
        className={cn(
          "relative rounded-xl border p-4 cursor-pointer transition-all duration-200 group",
          active
            ? "border-fin-500/40 bg-fin-500/10 shadow-[0_0_20px_rgba(34,162,105,0.1)]"
            : isSelected
              ? "border-fin-500/30 bg-fin-500/5"
              : "border-white/[0.07] bg-card hover:border-white/[0.14] hover:bg-white/[0.03]",
          deleting && "opacity-60 pointer-events-none"
        )}
      >
        {/* Active glow edge */}
        {active && (
          <motion.div
            layoutId="doc-active"
            className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-fin-400"
          />
        )}

        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                active || isSelected ? "bg-fin-500/20" : "bg-white/[0.05] group-hover:bg-fin-500/10"
              )}
            >
              <FileText
                className={cn(
                  "w-5 h-5 transition-colors",
                  active || isSelected ? "text-fin-400" : "text-muted-foreground group-hover:text-fin-400"
                )}
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{doc.name}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs text-muted-foreground">{doc.ticker}</span>
                <span className="text-white/20">·</span>
                <span className="text-xs text-muted-foreground">{doc.type}</span>
                <span className="text-white/20">·</span>
                <span className="text-xs text-muted-foreground">{doc.pages}pp</span>
                {doc.status === "indexed" && doc.chunkCount > 0 && (
                  <>
                    <span className="text-white/20">·</span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Database className="w-2.5 h-2.5" />
                      {doc.chunkCount} chunks
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right-side controls: select checkbox or menu */}
          <div className="relative flex-shrink-0 flex items-center gap-1">
            {selectable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelectedDoc(doc.id);
                }}
                aria-label={isSelected ? "Deselect document" : "Select document"}
                aria-pressed={isSelected}
                className={cn(
                  "w-5 h-5 rounded-md border flex items-center justify-center transition-all",
                  isSelected
                    ? "bg-fin-500 border-fin-500 text-white"
                    : "border-white/15 hover:border-fin-500/60 group-hover:border-white/30"
                )}
              >
                {isSelected && <Check className="w-3 h-3" />}
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              aria-label="Document menu"
              className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded-md hover:bg-white/10 flex items-center justify-center"
            >
              <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-8 w-44 z-50 rounded-lg border border-white/10 bg-popover shadow-xl py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handleViewPdf}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" /> View PDF
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setChunksOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                  >
                    <Database className="w-3 h-3" /> View chunks
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setEditOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                  >
                    <Pencil className="w-3 h-3" /> Edit metadata
                  </button>
                  <div className="my-1 h-px bg-white/[0.06]" />
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {deleting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Processing progress bar (only when status === "processing") */}
        {isProcessing && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground inline-flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
                {processingPct < 30
                  ? "Extracting text…"
                  : processingPct < 70
                    ? "Chunking & embedding…"
                    : "Indexing vectors…"}
              </span>
              <span className="font-mono text-violet-300">{processingPct}%</span>
            </div>
            <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${processingPct}%` }}
                transition={{ duration: 0.4 }}
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400"
              />
            </div>
          </div>
        )}

        {/* Footer (status + size + uploaded-at) */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05]">
          <div className="flex items-center gap-1.5">
            <StatusIcon
              className={cn("w-3 h-3", cfg.color, isProcessing && "animate-spin")}
            />
            <span className={cn("text-xs", cfg.color)}>{cfg.label}</span>
            {doc.status === "indexed" && (
              <span className="text-xs text-muted-foreground">· {(doc.confidence * 100).toFixed(0)}% conf.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{relativeTime(doc.uploadedAt)}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(doc.size)}</span>
          </div>
        </div>

        {/* Tags */}
        {doc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {doc.tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.05] text-muted-foreground"
              >
                <Tag className="w-2.5 h-2.5" />
                {tag}
              </span>
            ))}
          </div>
        )}
      </motion.div>

      {/* Chunks inspector — calls GET /documents/{id}/chunks on demand */}
      <ChunksDialog
        documentId={doc.id}
        documentName={doc.name}
        open={chunksOpen}
        onOpenChange={setChunksOpen}
      />

      {/* Metadata editor — calls PATCH /documents/{id} on submit */}
      <EditDocumentDialog
        doc={doc}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
