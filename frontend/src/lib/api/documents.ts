/**
 * Documents API client — Phase 4 Week 7 wiring.
 *
 * Mirrors the FastAPI routes under /api/v1/documents (Phase 1 backend):
 *   GET    /documents               — paginated list for a workspace
 *   POST   /documents/upload        — multipart upload, returns DocumentUploadResponse
 *   GET    /documents/{id}          — single document
 *   GET    /documents/{id}/status   — polling endpoint for processing pipeline
 *   GET    /documents/{id}/chunks   — paginated chunks
 *   GET    /documents/{id}/file     — raw bytes (inline or attachment)
 *   PATCH  /documents/{id}          — manual metadata correction
 *   DELETE /documents/{id}
 *
 * All shapes match backend/app/db/schemas.py.
 */
import { apiFetch, type GetTokenFn } from "./client";

export type DocumentStatus =
  | "pending"
  | "uploading"
  | "uploaded"
  | "extracting"
  | "extracted"
  | "chunking"
  | "chunked"
  | "embedding"
  | "indexed"
  | "failed";

export type DocumentType =
  | "10-K"
  | "10-Q"
  | "earnings_call"
  | "annual_report"
  | "prospectus"
  | "other";

export interface DocumentOut {
  id: string;
  workspace_id: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  page_count: number | null;
  doc_type: DocumentType;
  company_name: string | null;
  ticker: string | null;
  fiscal_period: string | null;
  status: DocumentStatus;
  error_message: string | null;
  pii_scan_passed: boolean | null;
  avg_confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentStatusResponse {
  document_id: string;
  status: DocumentStatus;
  page_count: number | null;
  chunk_count: number;
  error_message: string | null;
  updated_at: string;
}

export interface DocumentUploadResponse {
  document_id: string;
  status: DocumentStatus;
  message: string;
}

export interface PaginatedList<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
}

/**
 * Mirrors backend/app/db/schemas.py::ChunkOut. Used by the chunks viewer
 * dialog so analysts can inspect what actually got indexed.
 */
export interface ChunkOut {
  id: string;
  document_id: string;
  text: string;
  chunk_type: "paragraph" | "table" | "section_header" | "list_item";
  chunk_index: number;
  page_number: number | null;
  char_start: number | null;
  char_end: number | null;
  source_section: string | null;
  table_header: string | null;
  created_at: string;
}

/**
 * Partial update body for PATCH /documents/{id}. Every field is optional;
 * the backend only mutates the keys you actually send. Setting a field to
 * `null` clears it; omitting it leaves the existing value untouched.
 */
export interface DocumentUpdate {
  doc_type?: DocumentType;
  company_name?: string | null;
  ticker?: string | null;
  fiscal_period?: string | null;
}

/** Alias kept for backwards compat with updateDocumentMetadata() call sites. */
export type DocumentMetadataUpdate = DocumentUpdate;

export async function listDocuments(
  workspaceId: string,
  opts: { page?: number; page_size?: number } = {},
  getToken?: GetTokenFn
): Promise<PaginatedList<DocumentOut>> {
  return apiFetch<PaginatedList<DocumentOut>>("/documents", {
    query: {
      workspace_id: workspaceId,
      page: opts.page ?? 1,
      page_size: opts.page_size ?? 50,
    },
    getToken,
  });
}

export async function getDocument(
  documentId: string,
  getToken?: GetTokenFn
): Promise<DocumentOut> {
  return apiFetch<DocumentOut>(`/documents/${documentId}`, { getToken });
}

export async function getDocumentStatus(
  documentId: string,
  getToken?: GetTokenFn
): Promise<DocumentStatusResponse> {
  return apiFetch<DocumentStatusResponse>(`/documents/${documentId}/status`, {
    getToken,
  });
}

/**
 * Paginated chunk list. Default page size matches the backend cap (50);
 * pass `chunkType` to filter to a single block kind ("table" is useful
 * when auditing financial-figure extraction).
 */
export async function getDocumentChunks(
  documentId: string,
  opts: {
    page?: number;
    page_size?: number;
    chunkType?: ChunkOut["chunk_type"];
  } = {},
  getToken?: GetTokenFn
): Promise<PaginatedList<ChunkOut>> {
  const query: Record<string, string | number | undefined> = {
    page: opts.page ?? 1,
    page_size: opts.page_size ?? 50,
  };
  if (opts.chunkType) query.chunk_type = opts.chunkType;
  return apiFetch<PaginatedList<ChunkOut>>(`/documents/${documentId}/chunks`, {
    query,
    getToken,
  });
}

/**
 * PATCH /documents/{id} — analyst metadata correction (ticker, doc_type,
 * fiscal_period, company_name). Returns the freshly persisted DocumentOut
 * so the caller can prime the React Query cache without a re-fetch.
 */
export async function updateDocument(
  documentId: string,
  body: DocumentUpdate,
  getToken?: GetTokenFn
): Promise<DocumentOut> {
  return apiFetch<DocumentOut>(`/documents/${documentId}`, {
    method: "PATCH",
    json: body,
    getToken,
  });
}

export interface UploadDocumentArgs {
  workspaceId: string;
  file: File;
  docType?: DocumentType;
  companyName?: string;
  ticker?: string;
  fiscalPeriod?: string;
  /** Optional progress callback; receives a percentage 0-100. */
  onProgress?: (pct: number) => void;
  getToken?: GetTokenFn;
}

/**
 * Upload via XMLHttpRequest so we can report streaming progress. Stays close
 * to the multipart contract the backend expects (file + workspace_id + form
 * fields). Returns the same DocumentUploadResponse the API does.
 */
export async function uploadDocument(args: UploadDocumentArgs): Promise<DocumentUploadResponse> {
  const { workspaceId, file, docType, companyName, ticker, fiscalPeriod, onProgress, getToken } = args;

  const form = new FormData();
  form.append("file", file);
  form.append("workspace_id", workspaceId);
  if (docType) form.append("doc_type", docType);
  if (companyName) form.append("company_name", companyName);
  if (ticker) form.append("ticker", ticker);
  if (fiscalPeriod) form.append("fiscal_period", fiscalPeriod);

  const token = getToken ? await getToken() : null;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url =
      (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1").replace(/\/$/, "") +
      "/documents/upload";

    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as DocumentUploadResponse);
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload aborted"));

    xhr.send(form);
  });
}

export async function deleteDocument(
  documentId: string,
  getToken?: GetTokenFn
): Promise<void> {
  await apiFetch(`/documents/${documentId}`, { method: "DELETE", getToken });
}

/**
 * GET /documents/{id}/chunks — paginated list of extracted chunks.
 *
 * Used by the "Chunks" inspector dialog so analysts can verify what the
 * extractor + chunker actually produced from their PDF (the input the RAG
 * pipeline retrieves over). Useful for debugging "why didn't my query find
 * X?" without round-tripping through the LLM.
 */
export async function listChunks(
  documentId: string,
  opts: { page?: number; page_size?: number; chunk_type?: string } = {},
  getToken?: GetTokenFn
): Promise<PaginatedList<ChunkOut>> {
  return apiFetch<PaginatedList<ChunkOut>>(`/documents/${documentId}/chunks`, {
    query: {
      page: opts.page ?? 1,
      page_size: opts.page_size ?? 50,
      chunk_type: opts.chunk_type,
    },
    getToken,
  });
}

/**
 * PATCH /documents/{id} — update analyst-corrected metadata fields.
 *
 * The backend coerces ticker to uppercase and silently ignores any
 * unrecognised keys, so we only send the four documented fields.
 */
export async function updateDocumentMetadata(
  documentId: string,
  body: DocumentMetadataUpdate,
  getToken?: GetTokenFn
): Promise<DocumentOut> {
  return apiFetch<DocumentOut>(`/documents/${documentId}`, {
    method: "PATCH",
    json: body,
    getToken,
  });
}

/**
 * Build a presigned URL endpoint we can hand to react-pdf.
 *
 * The Phase 1 backend exposes `/documents/{id}/file` which returns a 302 to
 * a presigned S3 URL (when USE_S3=true) or streams the local file (free mode).
 * Either way, react-pdf can consume the URL directly.
 */
export function getDocumentFileUrl(documentId: string): string {
  return (
    (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1").replace(/\/$/, "") +
    `/documents/${documentId}/file`
  );
}
