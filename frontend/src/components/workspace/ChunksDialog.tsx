"use client";
/**
 * ChunksDialog — analyst-facing inspector for GET /documents/{id}/chunks.
 *
 * Why this dialog exists
 * ──────────────────────
 * The RAG pipeline only retrieves over chunks (text + tables, ~500 tokens
 * each, with page + section provenance). When an answer feels wrong the
 * first debugging question is "did the chunker even produce useful pieces
 * for this document?". Before this dialog, the chunks endpoint was live on
 * the backend but completely invisible to users — so there was no way to
 * check that without hitting the API by hand.
 *
 * The dialog:
 *   - Pages through chunks 50 at a time (matches the backend default).
 *   - Lets the user filter by `chunk_type` (prose / table / header) matching
 *     the backend ChunkType enum values exactly.
 *   - Shows page number, section header and chunk index next to each
 *     excerpt so the chunk can be cross-referenced against the PDF.
 *
 * Read-only by design — there's no "regenerate chunks" affordance here. A
 * future iteration can add a `POST /documents/{id}/reindex` button driven by
 * the same dialog.
 */
import React, { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { Database, Hash, Layers, Loader2, AlertCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IS_LIVE_API } from "@/lib/api/client";
import { listChunks, type ChunkOut } from "@/lib/api/documents";

/**
 * Filter chip values must match the backend ChunkType enum *values* in
 * app/db/models.py (NOT the Python attribute names). The enum currently
 * exposes only three kinds:
 *   ChunkType.PROSE  → "prose"
 *   ChunkType.TABLE  → "table"
 *   ChunkType.HEADER → "header"
 *
 * If the backend grows new types ("list", "footnote", …) add chips here
 * AFTER the new ChunkType members ship — sending an unknown value would
 * silently return zero rows because the SQLAlchemy filter is exact-match.
 */
const CHUNK_TYPE_FILTERS: Array<{ value: string | undefined; label: string }> = [
  { value: undefined, label: "All" },
  { value: "prose", label: "Prose" },
  { value: "table", label: "Table" },
  { value: "header", label: "Headers" },
];

export interface ChunksDialogProps {
  documentId: string;
  documentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChunksDialog({
  documentId,
  documentName,
  open,
  onOpenChange,
}: ChunksDialogProps) {
  const { getToken } = useAuth();
  const [page, setPage] = useState(1);
  const [chunkType, setChunkType] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ["chunks", documentId, page, chunkType],
    queryFn: () =>
      listChunks(documentId, { page, page_size: 50, chunk_type: chunkType }, getToken),
    // We can only fetch when:
    //   1. The dialog is actually open (avoid prefetching from the row menu).
    //   2. Live mode is on — otherwise we'd hit a 404 against the mock store.
    enabled: open && IS_LIVE_API,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const hasNext = query.data?.has_next ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="flex flex-col max-h-[85vh]">
        <DialogHeader className="mb-3">
          <DialogTitle className="flex items-center gap-2">
            <Database className="w-4 h-4 text-fin-400" />
            Chunks · {documentName}
          </DialogTitle>
          <DialogDescription>
            Read-only view of every text and table chunk the extractor produced
            for this document. The RAG retriever scores against exactly these
            rows.
          </DialogDescription>
        </DialogHeader>

        {/* Filter bar */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {CHUNK_TYPE_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => {
                setChunkType(f.value);
                setPage(1);
              }}
              className={cn(
                "text-[11px] px-2 py-1 rounded-md font-medium transition-colors",
                chunkType === f.value
                  ? "bg-fin-500/15 text-fin-300"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground font-mono">
            {total} chunk{total === 1 ? "" : "s"}
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-white/[0.07] bg-white/[0.02] divide-y divide-white/[0.05]">
          {!IS_LIVE_API ? (
            <EmptyState
              icon={<AlertCircle className="w-5 h-5 text-amber-400" />}
              title="Backend not configured"
              detail="Set NEXT_PUBLIC_API_URL to connect to a running FastAPI backend before the chunks endpoint can be queried."
            />
          ) : query.isLoading ? (
            <EmptyState
              icon={<Loader2 className="w-5 h-5 animate-spin text-fin-400" />}
              title="Loading chunks…"
            />
          ) : query.isError ? (
            <EmptyState
              icon={<AlertCircle className="w-5 h-5 text-red-400" />}
              title="Could not load chunks"
              detail={(query.error as Error)?.message ?? "Unknown error"}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Database className="w-5 h-5 text-muted-foreground" />}
              title="No chunks for this filter"
              detail={
                chunkType
                  ? `Try a different chunk type — the document has no "${chunkType}" rows yet.`
                  : "The pipeline may still be processing. Wait until status reaches indexed and reopen."
              }
            />
          ) : (
            items.map((c) => <ChunkRow key={c.id} chunk={c} />)
          )}
        </div>

        {/* Footer pager */}
        <div className="flex items-center justify-between mt-3 flex-shrink-0">
          <span className="text-[11px] text-muted-foreground">
            Page {page} · {items.length} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || query.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext || query.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChunkRow({ chunk }: { chunk: ChunkOut }) {
  return (
    <div className="px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
        <span className="inline-flex items-center gap-0.5 font-mono">
          <Hash className="w-2.5 h-2.5" />
          {chunk.chunk_index}
        </span>
        <span className="text-white/20">·</span>
        <span className="inline-flex items-center gap-0.5">
          <Layers className="w-2.5 h-2.5" />
          {chunk.chunk_type}
        </span>
        {chunk.page_number != null && (
          <>
            <span className="text-white/20">·</span>
            <span>page {chunk.page_number}</span>
          </>
        )}
        {chunk.source_section && (
          <>
            <span className="text-white/20">·</span>
            <span className="truncate max-w-[200px]" title={chunk.source_section}>
              {chunk.source_section}
            </span>
          </>
        )}
        {chunk.table_header && (
          <>
            <span className="text-white/20">·</span>
            <span className="text-fin-400 truncate max-w-[180px]" title={chunk.table_header}>
              {chunk.table_header}
            </span>
          </>
        )}
      </div>
      <p className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap line-clamp-6">
        {chunk.text}
      </p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="mb-2">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {detail && (
        <p className="text-[11px] text-muted-foreground mt-1 max-w-md leading-relaxed">
          {detail}
        </p>
      )}
    </div>
  );
}
