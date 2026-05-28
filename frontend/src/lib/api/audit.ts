/**
 * Audit-log API client — wires the FastAPI /api/v1/audit/* routes.
 *
 * Mirrors backend/app/api/routes/audit.py:
 *   GET /audit                — list audit events for a workspace (paginated, filterable)
 *   GET /audit/{audit_id}     — fetch a single audit event by id
 *
 * The backend's audit_logs table is append-only (Postgres BEFORE UPDATE
 * trigger blocks mutation) and trimmed by a retention TTL job, so this
 * client deliberately exposes only read operations.
 */
import { apiFetch, type GetTokenFn } from "./client";
import type { PaginatedList } from "./documents";

/**
 * Mirrors `AuditLogOut` from backend/app/db/schemas.py.
 *
 * Note the `audit_metadata` field — Pydantic v2 reserves `metadata` so
 * the backend exposes the JSON column under this aliased name. Treat
 * its inner shape as opaque (`Record<string, unknown>`); different
 * action verbs persist different keys.
 */
export interface AuditLogOut {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  status_code: number | null;
  audit_metadata: Record<string, unknown> | null;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp — when this row becomes eligible for purge. */
  expires_at: string;
}

/**
 * Standard compliance query: "show me everything user X did, action Y,
 * between dates A and B." Every filter is optional; the workspace_id
 * is required because the route enforces workspace-owner authorisation.
 */
export interface ListAuditLogsOptions {
  workspace_id: string;
  user_id?: string;
  action?: string;
  resource_type?: string;
  resource_id?: string;
  /** ISO-8601 string. Inclusive lower bound on created_at. */
  since?: string;
  /** ISO-8601 string. Exclusive upper bound on created_at. */
  until?: string;
  page?: number;
  page_size?: number;
}

export async function listAuditLogs(
  opts: ListAuditLogsOptions,
  getToken?: GetTokenFn,
): Promise<PaginatedList<AuditLogOut>> {
  const query: Record<string, string | number | undefined> = {
    workspace_id: opts.workspace_id,
    page: opts.page ?? 1,
    page_size: opts.page_size ?? 50,
  };
  if (opts.user_id) query.user_id = opts.user_id;
  if (opts.action) query.action = opts.action;
  if (opts.resource_type) query.resource_type = opts.resource_type;
  if (opts.resource_id) query.resource_id = opts.resource_id;
  if (opts.since) query.since = opts.since;
  if (opts.until) query.until = opts.until;

  return apiFetch<PaginatedList<AuditLogOut>>("/audit", { query, getToken });
}

export async function getAuditLog(
  auditId: string,
  getToken?: GetTokenFn,
): Promise<AuditLogOut> {
  return apiFetch<AuditLogOut>(`/audit/${auditId}`, { getToken });
}
