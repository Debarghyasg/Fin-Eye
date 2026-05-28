"use client";
/**
 * DocumentEditDialog — wires PATCH /api/v1/documents/{id}.
 *
 * Lets analysts correct the four mutable metadata fields the backend
 * supports (`doc_type`, `ticker`, `company_name`, `fiscal_period`).
 *
 * Design notes:
 *   - The dialog re-fetches the latest server state via getDocument()
 *     when it opens. The local Zustand store has a smaller, optimistic
 *     shape; trusting that for an edit form would let stale values
 *     overwrite newer ones.
 *   - Only changed fields are sent in the PATCH body — empty/whitespace
 *     strings clear the field (sent as null) so analysts can wipe an
 *     incorrect ticker.
 *   - On success we prime the React Query cache and mirror the change
 *     into the local store row so the workspace card updates instantly.
 */
import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { AlertCircle, Loader2, Pencil } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ApiError,
  IS_LIVE_API,
  getDocument,
  updateDocument,
  type DocumentOut,
  type DocumentType,
  type DocumentUpdate,
} from "@/lib/api";
import type { Document } from "@/store/useAppStore";
import { useAppStore } from "@/store/useAppStore";

const DOC_TYPES: DocumentType[] = [
  "10-K",
  "10-Q",
  "earnings_call",
  "annual_report",
  "prospectus",
  "other",
];

interface DocumentEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string | null;
}

export function DocumentEditDialog({ open, onOpenChange, documentId }: DocumentEditDialogProps) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const updateLocalDoc = useAppStore((s) => s.updateDocument);

  const docQuery = useQuery<DocumentOut>({
    queryKey: ["document", documentId],
    queryFn: () => getDocument(documentId!, getToken),
    enabled: open && IS_LIVE_API && Boolean(documentId),
    staleTime: 30_000,
  });
  const live = docQuery.data ?? null;

  // Form state — initialised from the live response. Strings (not null)
  // because <Input value={…}> rejects nullish; "" maps back to null on submit.
  const [docType, setDocType] = useState<DocumentType>("other");
  const [ticker, setTicker] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [fiscalPeriod, setFiscalPeriod] = useState("");

  useEffect(() => {
    if (!live) return;
    setDocType(live.doc_type);
    setTicker(live.ticker ?? "");
    setCompanyName(live.company_name ?? "");
    setFiscalPeriod(live.fiscal_period ?? "");
  }, [live?.id, live?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: () => {
      if (!live) throw new Error("Document not loaded");
      const body: DocumentUpdate = {};
      if (docType !== live.doc_type) body.doc_type = docType;
      const trimmedTicker = ticker.trim().toUpperCase();
      const trimmedCompany = companyName.trim();
      const trimmedFiscal = fiscalPeriod.trim();
      if (trimmedTicker !== (live.ticker ?? "")) {
        body.ticker = trimmedTicker || null;
      }
      if (trimmedCompany !== (live.company_name ?? "")) {
        body.company_name = trimmedCompany || null;
      }
      if (trimmedFiscal !== (live.fiscal_period ?? "")) {
        body.fiscal_period = trimmedFiscal || null;
      }
      return updateDocument(live.id, body, getToken);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["document", updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      // Mirror into the optimistic store so list cards re-render.
      // The cast keeps TypeScript honest — we're patching just two of the
      // store's many fields and trust runtime to merge cleanly.
      updateLocalDoc(updated.id, {
        ticker: updated.ticker ?? "",
        type: updated.doc_type,
      } as Partial<Document>);
      onOpenChange(false);
    },
  });

  const isDirty =
    !!live &&
    (docType !== live.doc_type ||
      ticker.trim().toUpperCase() !== (live.ticker ?? "") ||
      companyName.trim() !== (live.company_name ?? "") ||
      fiscalPeriod.trim() !== (live.fiscal_period ?? ""));

  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : (mutation.error as Error | undefined)?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-3.5 h-3.5 text-fin-400" />
            Edit document
          </DialogTitle>
          <DialogDescription className="truncate">
            {live?.original_filename ?? documentId ?? ""}
          </DialogDescription>
        </DialogHeader>

        {!IS_LIVE_API && (
          <p className="text-xs text-amber-300">
            Editing requires a live backend. Set{" "}
            <code className="text-fin-300">NEXT_PUBLIC_API_URL</code> and reload.
          </p>
        )}

        {IS_LIVE_API && docQuery.isLoading && (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}

        {IS_LIVE_API && docQuery.isError && (
          <div className="flex items-start gap-2 py-2 px-3 rounded-md bg-red-500/5 border border-red-500/20 text-xs">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
            <span className="text-red-300">
              {(docQuery.error as Error)?.message ?? "Could not load document."}
            </span>
          </div>
        )}

        {IS_LIVE_API && live && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!isDirty || mutation.isPending) return;
              mutation.mutate();
            }}
            className="space-y-3"
          >
            <Field label="Document type">
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocumentType)}
                className="h-9 w-full rounded-md border border-white/[0.07] bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-fin-500/40"
              >
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>

            <Field label="Ticker">
              <Input
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="AAPL"
                maxLength={20}
                className="h-9 text-xs uppercase"
              />
            </Field>

            <Field label="Company name">
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Apple Inc."
                maxLength={255}
                className="h-9 text-xs"
              />
            </Field>

            <Field label="Fiscal period">
              <Input
                value={fiscalPeriod}
                onChange={(e) => setFiscalPeriod(e.target.value)}
                placeholder="FY2023 or Q3-2024"
                maxLength={32}
                className="h-9 text-xs"
              />
            </Field>

            {errorMessage && (
              <div className="flex items-start gap-2 py-2 px-3 rounded-md bg-red-500/5 border border-red-500/20 text-xs">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                <span className="text-red-300">{errorMessage}</span>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="text-xs gap-1.5"
                disabled={!isDirty || mutation.isPending}
              >
                {mutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                {mutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
