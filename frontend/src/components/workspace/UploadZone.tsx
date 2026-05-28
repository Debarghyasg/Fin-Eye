"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@clerk/nextjs";

import { cn, formatBytes } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { useAppStore } from "@/store/useAppStore";
import { IS_LIVE_API } from "@/lib/api/client";
import { useWorkspaceId } from "@/lib/use-workspace";
import {
  uploadDocument,
  getDocumentStatus,
  type DocumentStatus,
} from "@/lib/api/documents";

type UploadFile = {
  id: string;
  file: File;
  status: "uploading" | "processing" | "done" | "error";
  progress: number;
};

/**
 * Map the backend's coarse pipeline status to a 0-100 progress percentage
 * for the DocumentCard ring. The backend doesn't emit a numeric pct, so
 * we fan it out across the known status transitions.
 */
const STATUS_PCT: Record<DocumentStatus, number> = {
  pending: 5,
  uploading: 8,
  uploaded: 12,
  extracting: 25,
  extracted: 40,
  chunking: 55,
  chunked: 65,
  embedding: 80,
  indexed: 100,
  failed: 0,
};

export function UploadZone() {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const addDocument = useAppStore((s) => s.addDocument);
  const updateDocument = useAppStore((s) => s.updateDocument);

  // Clerk hooks. When IS_LIVE_API is false we never call getToken, so
  // the offline-friendly mock mode keeps working without sign-in.
  const { getToken, isSignedIn } = useAuth();

  // Shared workspace resolver — handles env override and /auth/me/workspaces
  // fallback behind a single React Query cache so every page agrees on
  // the current workspace ID.
  const workspaceId = useWorkspaceId();

  // Track per-document polling intervals so we can clean up on unmount.
  const pollersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  useEffect(() => {
    return () => {
      pollersRef.current.forEach((id) => clearInterval(id));
      pollersRef.current.clear();
    };
  }, []);

  /**
   * Mock fallback (used when NEXT_PUBLIC_API_URL is unset). Keeps the
   * existing offline demo behaviour so designers can iterate without a
   * backend running.
   */
  const simulate = useCallback(
    (id: string, file: File) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 18 + 5;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === id ? { ...f, status: "processing", progress: 100 } : f
            )
          );
          setTimeout(() => {
            setFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, status: "done" } : f))
            );
            addDocument({
              id,
              name: file.name,
              type: "10-K",
              company: file.name.split("_")[0] || "Unknown",
              ticker:
                file.name.split("_")[0]?.toUpperCase().slice(0, 5) || "N/A",
              size: file.size,
              pages: Math.floor(Math.random() * 120) + 20,
              chunkCount: 0,
              uploadedAt: new Date(),
              status: "processing",
              tags: ["uploaded"],
              confidence: 0,
              processingProgress: 0,
            } as any);
          }, 1800);
        } else {
          setFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, progress } : f))
          );
        }
      }, 180);
    },
    [addDocument]
  );

  /**
   * Real upload path: hit the FastAPI backend, then poll status every
   * 2 s until the pipeline reaches `indexed` or `failed`.
   */
  const realUpload = useCallback(
    async (uploadId: string, file: File) => {
      try {
        if (!workspaceId) {
          throw new Error(
            "No workspace found for current user. Sign out and sign back in to bootstrap one."
          );
        }

        // 1) Multipart upload with browser progress events.
        const resp = await uploadDocument({
          workspaceId,
          file,
          onProgress: (pct) =>
            setFiles((prev) =>
              prev.map((f) =>
                f.id === uploadId ? { ...f, progress: pct } : f
              )
            ),
          getToken,
        });

        // 2) Flip the inline tile to "processing" and add the real
        //    document to the store so DocumentCard renders.
        setFiles((prev) =>
          prev.map((f) =>
            f.id === uploadId
              ? { ...f, status: "processing", progress: 100 }
              : f
          )
        );
        addDocument({
          id: resp.document_id,
          name: file.name,
          type: "10-K",
          company: file.name.split("_")[0] || "—",
          ticker: file.name.split("_")[0]?.toUpperCase().slice(0, 5) || "—",
          size: file.size,
          pages: 0,
          chunkCount: 0,
          uploadedAt: new Date(),
          status: "processing",
          tags: ["uploaded"],
          confidence: 0,
          processingProgress: STATUS_PCT[resp.status] ?? 10,
        } as any);

        // 3) Poll status every 2 s. Stops at terminal status, or after
        //    a hard cap of ~5 minutes so we never leak intervals.
        let ticks = 0;
        const docId = resp.document_id;
        const handle = setInterval(async () => {
          ticks++;
          try {
            const s = await getDocumentStatus(docId, getToken);
            const pct = STATUS_PCT[s.status] ?? 10;
            updateDocument(docId, {
              status: s.status === "indexed" ? "indexed" : "processing",
              processingProgress: pct,
              chunkCount: s.chunk_count,
              pages: s.page_count ?? 0,
            } as any);

            if (s.status === "indexed") {
              clearInterval(handle);
              pollersRef.current.delete(docId);
              setFiles((prev) =>
                prev.map((f) =>
                  f.id === uploadId ? { ...f, status: "done" } : f
                )
              );
            } else if (s.status === "failed") {
              clearInterval(handle);
              pollersRef.current.delete(docId);
              updateDocument(docId, {
                status: "failed",
                processingProgress: 0,
              } as any);
              setFiles((prev) =>
                prev.map((f) =>
                  f.id === uploadId ? { ...f, status: "error" } : f
                )
              );
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("[upload] status poll failed", err);
          }

          if (ticks > 150) {
            clearInterval(handle);
            pollersRef.current.delete(docId);
          }
        }, 2000);

        pollersRef.current.set(docId, handle);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[upload] failed", err);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === uploadId ? { ...f, status: "error" } : f
          )
        );
      }
    },
    [getToken, addDocument, updateDocument, workspaceId]
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      const newFiles: UploadFile[] = accepted.map((file) => ({
        id: `upload-${Date.now()}-${Math.random()}`,
        file,
        status: "uploading",
        progress: 0,
      }));
      setFiles((prev) => [...prev, ...newFiles]);

      newFiles.forEach((f) => {
        if (IS_LIVE_API && isSignedIn && workspaceId) {
          void realUpload(f.id, f.file);
        } else {
          simulate(f.id, f.file);
        }
      });
    },
    [simulate, realUpload, isSignedIn, workspaceId]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt"],
    },
    maxSize: 50 * 1024 * 1024,
  });

  const remove = (id: string) => setFiles((p) => p.filter((f) => f.id !== id));

  return (
    <div className="space-y-4">
      {IS_LIVE_API && !isSignedIn && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          You&apos;re not signed in — uploads will use the offline mock. Sign
          in to upload to the real backend.
        </div>
      )}

      <motion.div
        {...getRootProps()}
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.998 }}
        className={cn(
          "relative rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-all duration-300 overflow-hidden",
          isDragActive
            ? "border-fin-400 bg-fin-500/10"
            : "border-white/10 hover:border-fin-500/40 hover:bg-white/[0.02]"
        )}
      >
        <input {...getInputProps()} />

        <AnimatePresence>
          {isDragActive && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-gradient-to-br from-fin-500/10 to-transparent pointer-events-none"
            />
          )}
        </AnimatePresence>

        <motion.div
          animate={
            isDragActive
              ? { scale: 1.1, rotate: [0, -5, 5, 0] }
              : { scale: 1, rotate: 0 }
          }
          transition={{ duration: 0.3 }}
          className="mx-auto w-12 h-12 rounded-xl bg-fin-500/10 border border-fin-500/20 flex items-center justify-center mb-4"
        >
          <Upload className="w-5 h-5 text-fin-400" />
        </motion.div>

        {isDragActive ? (
          <p className="text-fin-300 font-medium">Drop files to upload…</p>
        ) : (
          <>
            <p className="font-medium text-foreground mb-1">
              Drag & drop financial documents
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              10-Ks, earnings call transcripts, prospectuses, annual reports
            </p>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-fin-500/10 border border-fin-500/20 text-xs text-fin-300">
              PDF · DOCX · TXT up to 50 MB · S3 + KMS encrypted at rest
            </span>
          </>
        )}
      </motion.div>

      <AnimatePresence>
        {files.map((f) => (
          <motion.div
            key={f.id}
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.07] bg-card">
              <div className="w-9 h-9 rounded-lg bg-fin-500/10 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-fin-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium truncate">{f.file.name}</p>
                  <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                    {formatBytes(f.file.size)}
                  </span>
                </div>
                {f.status === "uploading" && (
                  <div className="space-y-1">
                    <Progress value={f.progress} className="h-1" />
                    <p className="text-xs text-muted-foreground">
                      Uploading… {Math.round(f.progress)}%
                    </p>
                  </div>
                )}
                {f.status === "processing" && (
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 text-fin-400 animate-spin" />
                    <p className="text-xs text-fin-300">
                      Extracting & indexing on the backend…
                    </p>
                  </div>
                )}
                {f.status === "done" && (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <p className="text-xs text-emerald-400">
                      Indexed successfully · PII scan passed
                    </p>
                  </div>
                )}
                {f.status === "error" && (
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3 text-red-400" />
                    <p className="text-xs text-red-400">
                      Upload failed — see browser console for details
                    </p>
                  </div>
                )}
              </div>
              {(f.status === "done" || f.status === "error") && (
                <button
                  onClick={() => remove(f.id)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
