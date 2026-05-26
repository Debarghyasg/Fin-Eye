"use client";
/**
 * Document viewer — Phase 4 Week 7 Day 5-7.
 *
 * "When a user clicks a citation in the sources panel, the PDF opens on
 *  the exact page with the relevant text highlighted."
 *
 * Architecture
 * ────────────
 *   - Reads `activeSource` from useAppStore. When non-null the dialog
 *     opens; closing the dialog calls setActiveSource(null).
 *   - Renders the PDF with react-pdf. The pdfjs worker is loaded from
 *     unpkg so we don't need to ship the worker file ourselves.
 *   - When `IS_LIVE_API` is true, the file URL is the Phase 1 backend
 *     `/documents/{id}/file` endpoint. When false (the default
 *     mock-driven dev experience), we render a styled placeholder that
 *     still demonstrates the highlighting UX — important for demos
 *     without a backend.
 *   - After each page renders its text layer, lib/pdf-highlight.ts
 *     runs over the spans and adds the .phase4-cite-highlight class
 *     to anything matching the cited excerpt. The first matching span
 *     is scrolled into view.
 *
 * Page navigation, zoom, and a sticky "cited passage" header are all
 * here so the viewer feels like a real document reader.
 */
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2,
  Loader2, AlertCircle, BookOpen, FileText, ExternalLink, X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import { IS_LIVE_API } from "@/lib/api/client";
import { getDocumentFileUrl } from "@/lib/api/documents";
import { highlightExcerpt } from "@/lib/pdf-highlight";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

// Configure the pdfjs worker once on first import. unpkg serves the worker
// for the exact version of pdfjs-dist that react-pdf was built against,
// so the API in worker + main thread always match. react-pdf 9.x ships
// pdfjs-dist 4.x, whose worker bundle is now an ESM .mjs file.
if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.15;

interface ViewerInnerProps {
  docId: string;
  initialPage: number;
  excerpt: string;
  onClose: () => void;
}

function ViewerInner({ docId, initialPage, excerpt, onClose }: ViewerInnerProps) {
  const documents = useAppStore((s) => s.documents);
  const doc = documents.find((d) => d.id === docId);

  const [pageNumber, setPageNumber] = useState(initialPage);
  const [pageInputValue, setPageInputValue] = useState(String(initialPage));
  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState(1.1);
  const pageContainerRef = useRef<HTMLDivElement>(null);

  // Reset page state when the user clicks a different source
  useEffect(() => {
    setPageNumber(initialPage);
    setPageInputValue(String(initialPage));
  }, [initialPage, docId]);

  const goToPage = (n: number) => {
    if (!numPages) {
      setPageNumber(n);
      setPageInputValue(String(n));
      return;
    }
    const clamped = Math.max(1, Math.min(numPages, n));
    setPageNumber(clamped);
    setPageInputValue(String(clamped));
  };

  const onTextLayerSuccess = () => {
    // Defer one frame so react-pdf has finished mounting all spans
    requestAnimationFrame(() => {
      if (!pageContainerRef.current) return;
      const layer = pageContainerRef.current.querySelector(
        ".react-pdf__Page__textContent"
      ) as HTMLElement | null;
      const first = highlightExcerpt(layer, excerpt);
      if (first) {
        first.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  };

  const fileUrl = IS_LIVE_API ? getDocumentFileUrl(docId) : null;

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pb-3 border-b border-white/[0.07] flex-shrink-0">
        <div className="w-9 h-9 rounded-lg bg-fin-500/10 flex items-center justify-center flex-shrink-0">
          <FileText className="w-4 h-4 text-fin-400" />
        </div>
        <div className="flex-1 min-w-0">
          <DialogTitle className="text-sm truncate">
            {doc?.name ?? docId}
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground truncate">
            {doc
              ? `${doc.ticker ?? ""}${doc.ticker ? " · " : ""}${doc.company ?? ""} · ${doc.type ?? ""}`
              : "Document"}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close viewer">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* ── Cited passage banner ────────────────────────────────────────── */}
      <div className="my-3 p-3 rounded-lg bg-fin-500/10 border border-fin-500/25 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1.5">
          <BookOpen className="w-3.5 h-3.5 text-fin-400" />
          <span className="text-[10px] uppercase tracking-wide text-fin-400 font-semibold">
            Cited passage on page {initialPage}
          </span>
        </div>
        <p className="text-xs text-foreground italic leading-relaxed">"{excerpt}"</p>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => goToPage(pageNumber - 1)}
          disabled={pageNumber <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(pageInputValue, 10);
            if (Number.isFinite(n)) goToPage(n);
          }}
          className="flex items-center gap-1.5 text-xs"
        >
          <input
            type="text"
            inputMode="numeric"
            value={pageInputValue}
            onChange={(e) => setPageInputValue(e.target.value.replace(/[^0-9]/g, ""))}
            className="w-12 h-7 rounded-md bg-white/[0.04] border border-white/10 text-center text-xs focus:border-fin-500/40 focus:outline-none"
          />
          <span className="text-muted-foreground">/ {numPages ?? "—"}</span>
        </form>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => goToPage(pageNumber + 1)}
          disabled={!!numPages && pageNumber >= numPages}
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-[10px] font-mono w-10 text-center text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setScale(1.1)}
            aria-label="Reset zoom"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
          {fileUrl && (
            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              aria-label="Open original PDF in new tab"
            >
              <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* ── PDF surface ─────────────────────────────────────────────────── */}
      <div
        ref={pageContainerRef}
        className="flex-1 min-h-0 overflow-auto rounded-lg bg-white/[0.02] border border-white/[0.07] p-4 flex items-start justify-center"
      >
        {fileUrl ? (
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            loading={<PdfLoading />}
            error={<PdfError message="Could not load this PDF" />}
            className="w-full flex justify-center"
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer
              renderAnnotationLayer={false}
              onRenderTextLayerSuccess={onTextLayerSuccess}
              loading={<PdfLoading />}
              error={<PdfError message={`Could not render page ${pageNumber}`} />}
              className="shadow-2xl"
            />
          </Document>
        ) : (
          <MockPdfPage
            docName={doc?.name ?? "document.pdf"}
            excerpt={excerpt}
            pageNumber={pageNumber}
            scale={scale}
          />
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.07] flex-shrink-0 text-[10px] text-muted-foreground">
        <span>
          {fileUrl
            ? "Live PDF · pdfjs (text layer enabled)"
            : "Demo viewer · connect a backend to render real PDFs"}
        </span>
        <span>
          Highlights produced by lib/pdf-highlight.ts (trigram matcher)
        </span>
      </div>
    </>
  );
}

/* ── Loading + error states ────────────────────────────────────────────── */
function PdfLoading() {
  return (
    <div className="flex flex-col items-center justify-center text-muted-foreground py-16">
      <Loader2 className="w-6 h-6 animate-spin text-fin-400 mb-2" />
      <p className="text-xs">Loading PDF…</p>
    </div>
  );
}

function PdfError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-red-400 py-16 max-w-md text-center">
      <AlertCircle className="w-6 h-6 mb-2" />
      <p className="text-xs font-medium">{message}</p>
      <p className="text-[10px] text-muted-foreground mt-1">
        Make sure NEXT_PUBLIC_API_URL points at a running backend and that
        the document has finished indexing.
      </p>
    </div>
  );
}

/* ── Mock PDF page — used in dev when no backend is configured ─────────── */
function MockPdfPage({
  docName,
  excerpt,
  pageNumber,
  scale,
}: {
  docName: string;
  excerpt: string;
  pageNumber: number;
  scale: number;
}) {
  // Render a paper-like stand-in. Highlight the excerpt prominently in the
  // body text so users can still see the citation-highlight UX even with
  // no real PDF available.
  return (
    <div
      style={{
        width: 612 * scale,
        minHeight: 792 * scale,
        transition: "width 200ms ease, min-height 200ms ease",
      }}
      className={cn(
        "bg-white text-black rounded-md shadow-2xl p-12 flex flex-col font-serif"
      )}
    >
      <div className="text-[10px] uppercase tracking-widest text-gray-400 border-b border-gray-200 pb-2 mb-6">
        {docName} · page {pageNumber}
      </div>

      <p className="text-sm leading-relaxed text-gray-700 mb-4">
        Mock document body — connect a backend to load the real PDF. The
        cited passage from your search result is shown below with the same
        green-tinted highlight that the real react-pdf text layer would
        receive.
      </p>

      <p className="text-sm leading-relaxed text-gray-800 mb-4">
        For the year ended September 30, the Company reported total net
        sales and key operating metrics that informed management discussion
        and analysis of period-over-period performance.
      </p>

      <p className="text-sm leading-relaxed text-gray-800 mb-4">
        <span className="phase4-cite-highlight" style={{ color: "#0f172a" }}>
          {excerpt}
        </span>
      </p>

      <p className="text-sm leading-relaxed text-gray-700 mb-4">
        Continuing investments in research and development, expansion of
        services revenue, and management of operating expenses remain core
        priorities. Refer to the Risk Factors and Management Discussion and
        Analysis sections for additional context on the period.
      </p>

      <div className="flex-1" />
      <div className="text-[10px] text-gray-400 text-right border-t border-gray-200 pt-2 mt-6">
        {pageNumber}
      </div>
    </div>
  );
}

/* ── Public component — mounted once globally in (app)/layout.tsx ─────── */
export function DocumentViewer() {
  const activeSource = useAppStore((s) => s.activeSource);
  const setActiveSource = useAppStore((s) => s.setActiveSource);

  const open = activeSource !== null;
  const close = () => setActiveSource(null);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent
        size="full"
        hideClose
        className="flex flex-col p-5 gap-0 overflow-hidden"
      >
        {activeSource && (
          <ViewerInner
            docId={activeSource.docId}
            initialPage={activeSource.page}
            excerpt={activeSource.excerpt}
            onClose={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
