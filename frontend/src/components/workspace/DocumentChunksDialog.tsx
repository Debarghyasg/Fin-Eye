"use client";
/**
 * DocumentChunksDialog — wires GET /api/v1/documents/{id}/chunks.
 *
 * Lets the user inspect the chunks the extractor + chunker actually
 * produced for a given document. Useful for:
 *   - Debugging hits/misses in retrieval ("did the table even get parsed?")
 *   - Spot-checking PII redaction edge cases
 *   - QA'ing the chunking strategy on a new doc type
 *
 * Filters by chunk_type (paragraph / table / section_header / list_item)
 * and paginates server-side at 50 chunks per page (matches backend cap).
 */
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { AlertCircle, Database, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IS_LIVE_API,
  getDocumentChunks,
  type ChunkOut,
  type PaginatedList,
} from "@/lib/api";
import { cn, formatNumber } from "@/lib/utils";

const PAGE_SIZE = 50;

const CHUNK_BADGE: Record<
  ChunkOut["chunk_type"],
  { label: string; classes: string }
> = {
  paragraph:      { label: "para",   classes: "bg-fin-500/10 text-fin-300" },
  table:          { label: "table",  classes: "bg-amber-500/10 text-amber-300" },
  section_header: { label: "header", classes: "bg-blue-500/10 text-blue-300" },
  list_item:      { label: "list",   classes: "bg-violet-500/10 text-violet-300" },
};

const FILTERS: Array<ChunkOut["chunk_type"] | "all"> = [
  "all",
  "paragraph",
  "table",
  "section_header",
  "list_item",
];

interface DocumentChunksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string | null;
  documentName?: string;
}

export function DocumentChunksDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
}: DocumentChunksDialogProps) {
  const { getToken } = useAuth();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<ChunkOut["chunk_type"] | "all">("all");

  // Reset paging whenever the dialog opens for a different document.
  React.useEffect(() => {
    if (open) {
      setPage(1);
      setFilter("all");
    }
  }, [open, documentId]);

  const chunkQuery = useQuery<PaginatedList<ChunkOut>>({
    queryKey: ["document-chunks", documentId, page, filter],
    queryFn: () =>
      getDocumentChunks(
        documentId!,
        {
          page,
          page_size: PAGE_SIZE,
          chunkType: filter === "all" ? undefined : filter,
        },
        getToken,
      ),
    enabled: open && IS_LIVE_API && Boolean(documentId),
    staleTime: 30_000,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="h-[80vh] flex flex-col p-5">
        <DialogHeader className="mb-2">
          <DialogTitle className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-fin-400" />
            <span>Indexed chunks</span>
            {chunkQuery.data && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 ml-1">
                {formatNumber(chunkQuery.data.total)} total
              </Badge>
            )}
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">
            {documentName ?? documentId ?? ""}
          </p>
        </DialogHeader>

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          {FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setFilter(t);
                setPage(1);
              }}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                filter === t
                  ? "bg-fin-500/20 text-fin-300"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5",
              )}
            >
              {t === "all" ? "All" : t.replace("_", " ")}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto mt-3 -mx-1 px-1 space-y-2">
          {!IS_LIVE_API && (
            <EmptyState text="Connect a backend to view extracted chunks." />
          )}

          {IS_LIVE_API && chunkQuery.isLoading && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          )}

          {IS_LIVE_API && chunkQuery.isError && (
            <div className="flex items-start gap-2 py-3 px-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-300">Could not load chunks</p>
                <p className="text-muted-foreground">
                  {(chunkQuery.error as Error)?.message ?? "Backend unavailable."}
                </p>
              </div>
            </div>
          )}

          {IS_LIVE_API && chunkQuery.data && chunkQuery.data.items.length === 0 && (
            <EmptyState text="No chunks match this filter." />
          )}

          {chunkQuery.data?.items.map((chunk) => {
            const badge = CHUNK_BADGE[chunk.chunk_type] ?? CHUNK_BADGE.paragraph;
            return (
              <div
                key={chunk.id}
                className="rounded-lg border border-white/[0.07] bg-card p-3 hover:border-white/[0.14] transition-colors"
              >
                <div className="flex items-center gap-2 mb-2 text-[11px] flex-wrap">
                  <span className="font-mono text-muted-foreground">
                    #{chunk.chunk_index}
                  </span>
                  <span className={cn("px-1.5 py-0.5 rounded font-medium", badge.classes)}>
                    {badge.label}
                  </span>
                  {chunk.page_number != null && (
                    <span className="text-muted-foreground">p.{chunk.page_number}</span>
                  )}
                  {chunk.source_section && (
                    <span className="text-muted-foreground truncate">
                      · {chunk.source_section}
                    </span>
                  )}
                  {chunk.table_header && (
                    <span className="text-amber-300/70 truncate">
                      · {chunk.table_header}
                    </span>
                  )}
                </div>
                <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed font-mono">
                  {chunk.text}
                </p>
              </div>
            );
          })}
        </div>

        {/* Pagination footer */}
        {chunkQuery.data && chunkQuery.data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-3 border-t border-white/[0.05] flex-shrink-0">
            <span className="text-xs text-muted-foreground">
              Page {page} · showing {chunkQuery.data.items.length} of{" "}
              {formatNumber(chunkQuery.data.total)}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1 || chunkQuery.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="text-xs h-7"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!chunkQuery.data.has_next || chunkQuery.isFetching}
                onClick={() => setPage((p) => p + 1)}
                className="text-xs h-7 gap-1.5"
              >
                {chunkQuery.isFetching && <Loader2 className="w-3 h-3 animate-spin" />}
                Next
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="text-xs text-muted-foreground py-8 text-center border border-dashed border-white/10 rounded-lg">
      {text}
    </p>
  );
}
