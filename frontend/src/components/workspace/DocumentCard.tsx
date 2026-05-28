"use client";
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Loader2,
  MoreVertical,
  Pencil,
  Tag,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, IS_LIVE_API, deleteDocument } from "@/lib/api";
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

import { DocumentChunksDialog } from "./DocumentChunksDialog";
import { DocumentEditDialog } from "./DocumentEditDialog";

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
 * Wiring (PR follow-up):
 *   - Menu "View PDF"      → opens the existing DocumentViewer via setActiveSource
 *   - Menu "Edit metadata" → opens DocumentEditDialog (PATCH /documents/{id})
 *   - Menu "View chunks"   → opens DocumentChunksDialog (GET /documents/{id}/chunks)
 *   - Menu "Delete"        → confirm dialog → DELETE /documents/{id}
 */
export function DocumentCard({ doc, onClick, active = false, selectable = false }: DocumentCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [chunksOpen, setChunksOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  // ── Delete mutation ──────────────────────────────────────────────────
  // Was previously fire-and-forget on the local store only (the
  // `deleteDocument` API client was declared but never invoked). Now it
  // hits DELETE /documents/{id}, then prunes the local store + cache so
  // the workspace card list updates without a re-fetch round-trip.
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!IS_LIVE_API) {
        // Mock mode: just drop the local store row.
        return undefined;
      }
      await deleteDocument(doc.id, getToken);
    },
    onSuccess: () => {
      removeDocument(doc.id);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.removeQueries({ queryKey: ["document", doc.id] });
      queryClient.removeQueries({ queryKey: ["document-chunks", doc.id] });
      setConfirmOpen(false);
      setMenuOpen(false);
    },
    onError: (err: unknown) => {
      setDeleteError(
        err instanceof ApiError
          ? err.message
          : (err as Error)?.message ?? "Delete failed.",
      );
    },
  });

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
                active || isSelected
                  ? "bg-fin-500/20"
                  : "bg-white/[0.05] group-hover:bg-fin-500/10",
              )}
            >
              <FileText
                className={cn(
                  "w-5 h-5 transition-colors",
                  active || isSelected
                    ? "text-fin-400"
                    : "text-muted-foreground group-hover:text-fin-400",
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
                    : "border-white/15 hover:border-fin-500/60 group-hover:border-white/30",
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
                  <MenuItem
                    icon={ExternalLink}
                    label="View PDF"
                    onClick={() => {
                      setMenuOpen(false);
                      // Open the existing DocumentViewer dialog at page 1 with
                      // an empty excerpt — the highlight overlay treats that
                      // as a no-op, so the user sees the bare page.
                      setActiveSource({ docId: doc.id, page: 1, excerpt: "" });
                    }}
                  />
                  <MenuItem
                    icon={Pencil}
                    label="Edit metadata"
                    onClick={() => {
                      setMenuOpen(false);
                      setEditOpen(true);
                    }}
                  />
                  <MenuItem
                    icon={Database}
                    label="View chunks"
                    onClick={() => {
                      setMenuOpen(false);
                      setChunksOpen(true);
                    }}
                  />
                  <div className="my-1 border-t border-white/[0.05]" />
                  <MenuItem
                    icon={Trash2}
                    label="Delete"
                    danger
                    onClick={() => {
                      setMenuOpen(false);
                      setDeleteError(null);
                      setConfirmOpen(true);
                    }}
                  />
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
              <span className="text-xs text-muted-foreground">
                · {(doc.confidence * 100).toFixed(0)}% conf.
              </span>
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

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      <DocumentEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        documentId={doc.id}
      />
      <DocumentChunksDialog
        open={chunksOpen}
        onOpenChange={setChunksOpen}
        documentId={doc.id}
        documentName={doc.name}
      />
      <DeleteConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o);
          if (!o) setDeleteError(null);
        }}
        document={doc}
        isPending={deleteMutation.isPending}
        error={deleteError}
        onConfirm={() => deleteMutation.mutate()}
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Subcomponents
 * ────────────────────────────────────────────────────────────────── */

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
        danger
          ? "text-red-400 hover:bg-red-500/10"
          : "text-muted-foreground hover:text-foreground hover:bg-white/5",
      )}
    >
      <Icon className="w-3 h-3" /> {label}
    </button>
  );
}

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  document: Document;
  isPending: boolean;
  error: string | null;
  onConfirm: () => void;
}

function DeleteConfirmDialog({
  open,
  onOpenChange,
  document,
  isPending,
  error,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            Delete document?
          </DialogTitle>
          <DialogDescription>
            This permanently removes <span className="text-foreground">{document.name}</span>{" "}
            and all of its extracted chunks from the workspace. The vector index entries
            and stored file are deleted too. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 py-2 px-3 rounded-md bg-red-500/5 border border-red-500/20 text-xs">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
            <span className="text-red-300">{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="text-xs gap-1.5 bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending && <Loader2 className="w-3 h-3 animate-spin" />}
            {isPending ? "Deleting…" : "Delete document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
