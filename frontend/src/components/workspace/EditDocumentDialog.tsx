"use client";
/**
 * EditDocumentDialog — wraps PATCH /documents/{id} so analysts can correct
 * the metadata fields the upload form couldn't always populate (ticker,
 * fiscal period, doc_type, company name).
 *
 * Why it lives in a dialog rather than inline on the card
 * ───────────────────────────────────────────────────────
 *   - The card has very little real estate; a four-field form would push
 *     the action footer out of view.
 *   - Using react-query's mutation gives us optimistic UI (the underlying
 *     query cache is invalidated on success) without code duplication
 *     across pages that may also show the document later.
 *
 * The form trims/uppercases ticker on submit because the backend already
 * does so, but the local normalisation prevents an awkward "no change?"
 * 200 OK when the user typed "aapl".
 */
import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { Pencil, Loader2, AlertCircle } from "lucide-react";

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
import { IS_LIVE_API } from "@/lib/api/client";
import {
  updateDocumentMetadata,
  type DocumentMetadataUpdate,
  type DocumentOut,
  type DocumentType,
} from "@/lib/api/documents";
import { useAppStore, type Document } from "@/store/useAppStore";

const DOC_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: "10-K", label: "10-K (Annual)" },
  { value: "10-Q", label: "10-Q (Quarterly)" },
  { value: "earnings_call", label: "Earnings call" },
  { value: "annual_report", label: "Annual report" },
  { value: "prospectus", label: "Prospectus" },
  { value: "other", label: "Other" },
];

export interface EditDocumentDialogProps {
  /** Store-side document we're editing — used for initial values + optimistic update. */
  doc: Document;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditDocumentDialog({ doc, open, onOpenChange }: EditDocumentDialogProps) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const updateLocalDocument = useAppStore((s) => s.updateDocument);

  // Map the store's UI labels back to backend enum values when seeding the
  // form. The store keeps friendlier strings ("10-K", "Earnings Call") so
  // we have to normalise.
  const seedDocType: DocumentType = mapStoreTypeToEnum(doc.type);

  const [docType, setDocType] = useState<DocumentType>(seedDocType);
  const [companyName, setCompanyName] = useState(doc.company === "—" ? "" : doc.company);
  const [ticker, setTicker] = useState(doc.ticker === "—" ? "" : doc.ticker);
  const [fiscalPeriod, setFiscalPeriod] = useState(
    doc.tags.find((t) => /^(FY|Q[1-4])/i.test(t)) ?? ""
  );
  const [error, setError] = useState<string | null>(null);

  // Reset form when a different document opens the dialog.
  useEffect(() => {
    if (open) {
      setDocType(mapStoreTypeToEnum(doc.type));
      setCompanyName(doc.company === "—" ? "" : doc.company);
      setTicker(doc.ticker === "—" ? "" : doc.ticker);
      setFiscalPeriod(doc.tags.find((t) => /^(FY|Q[1-4])/i.test(t)) ?? "");
      setError(null);
    }
  }, [open, doc.id, doc.type, doc.company, doc.ticker, doc.tags]);

  const mutation = useMutation({
    mutationFn: (body: DocumentMetadataUpdate) =>
      updateDocumentMetadata(doc.id, body, getToken),
    onSuccess: (server: DocumentOut) => {
      // Reflect the change in the Zustand store so DocumentCard updates
      // without waiting for the next listDocuments refetch.
      updateLocalDocument(doc.id, {
        company: server.company_name ?? "—",
        ticker: server.ticker ?? "—",
        type: enumToStoreType(server.doc_type),
        tags: server.fiscal_period
          ? // keep non-period tags + the new period
            Array.from(
              new Set([
                ...doc.tags.filter((t) => !/^(FY|Q[1-4])/i.test(t)),
                server.fiscal_period,
              ])
            )
          : doc.tags.filter((t) => !/^(FY|Q[1-4])/i.test(t)),
      });
      // Invalidate any react-query caches that show this document so the
      // SourcesPanel / DocumentViewer pick up the new ticker on next read.
      queryClient.invalidateQueries({ queryKey: ["document", doc.id] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Update failed");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!IS_LIVE_API) {
      // Mock-mode shortcut: persist locally without a backend call so
      // designers can iterate on the form without a running API.
      updateLocalDocument(doc.id, {
        company: companyName.trim() || "—",
        ticker: ticker.trim().toUpperCase() || "—",
        type: enumToStoreType(docType),
        tags: fiscalPeriod
          ? Array.from(
              new Set([
                ...doc.tags.filter((t) => !/^(FY|Q[1-4])/i.test(t)),
                fiscalPeriod.trim(),
              ])
            )
          : doc.tags.filter((t) => !/^(FY|Q[1-4])/i.test(t)),
      });
      onOpenChange(false);
      return;
    }

    const body: DocumentMetadataUpdate = {
      doc_type: docType,
      company_name: companyName.trim() || null,
      ticker: ticker.trim() || null,
      fiscal_period: fiscalPeriod.trim() || null,
    };
    mutation.mutate(body);
  };

  const submitting = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-fin-400" />
            Edit document metadata
          </DialogTitle>
          <DialogDescription>
            Corrections here update the database row. The original PDF and
            extracted chunks are not re-processed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Document type
            </label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocumentType)}
              className="w-full h-9 rounded-md border border-white/10 bg-white/[0.04] px-2 text-sm focus:border-fin-500/40 focus:outline-none"
              disabled={submitting}
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Ticker
              </label>
              <Input
                value={ticker}
                maxLength={20}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="AAPL"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Fiscal period
              </label>
              <Input
                value={fiscalPeriod}
                maxLength={20}
                onChange={(e) => setFiscalPeriod(e.target.value)}
                placeholder="FY2024 / Q3 2024"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Company name
            </label>
            <Input
              value={companyName}
              maxLength={255}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Apple Inc."
              disabled={submitting}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="glow" disabled={submitting}>
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving…
                </span>
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Type label adapters ──────────────────────────────────────────────── */
function mapStoreTypeToEnum(label: Document["type"]): DocumentType {
  switch (label) {
    case "10-K":
    case "10-Q":
      return label as DocumentType;
    case "Earnings Call":
      return "earnings_call";
    case "Annual Report":
      return "annual_report";
    case "Prospectus":
      return "prospectus";
    default:
      return "other";
  }
}

function enumToStoreType(value: DocumentType): Document["type"] {
  switch (value) {
    case "10-K":
      return "10-K";
    case "10-Q":
      // Not present in the mock-data union; cast to keep parity with
      // workspace/page.tsx which does the same widening.
      return "10-Q" as Document["type"];
    case "earnings_call":
      return "Earnings Call";
    case "annual_report":
      return "Annual Report";
    case "prospectus":
      return "Prospectus";
    default:
      return "Other" as Document["type"];
  }
}
