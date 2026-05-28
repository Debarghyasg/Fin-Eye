/**
 * Auth API client — wires the FastAPI /api/v1/auth/* routes.
 *
 * Mirrors backend/app/api/routes/auth.py:
 *   GET    /auth/me              — current user profile
 *   PATCH  /auth/me              — update full_name / email
 *   GET    /auth/me/workspaces   — list workspaces owned by the current user
 *   POST   /auth/me/workspaces   — create a new workspace
 *
 * Type shapes follow backend/app/db/schemas.py UserOut / UserUpdate /
 * WorkspaceOut / WorkspaceCreate. Keep them in lock-step with the
 * Pydantic models — there is no codegen yet.
 */
import { apiFetch, type GetTokenFn } from "./client";

export interface UserOut {
  id: string;
  clerk_user_id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  /** ISO-8601 timestamp from the backend. */
  created_at: string;
}

export interface UserUpdate {
  full_name?: string | null;
  email?: string | null;
}

export interface WorkspaceOut {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  /** Populated by the route handler; may be 0 even when documents exist. */
  document_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceCreate {
  name: string;
  description?: string | null;
}

// ── GET /auth/me ────────────────────────────────────────────────────────────
export async function getMe(getToken?: GetTokenFn): Promise<UserOut> {
  return apiFetch<UserOut>("/auth/me", { getToken });
}

// ── PATCH /auth/me ──────────────────────────────────────────────────────────
export async function updateMe(
  body: UserUpdate,
  getToken?: GetTokenFn,
): Promise<UserOut> {
  return apiFetch<UserOut>("/auth/me", {
    method: "PATCH",
    json: body,
    getToken,
  });
}

// ── GET /auth/me/workspaces ─────────────────────────────────────────────────
export async function listMyWorkspaces(
  getToken?: GetTokenFn,
): Promise<WorkspaceOut[]> {
  return apiFetch<WorkspaceOut[]>("/auth/me/workspaces", { getToken });
}

// ── POST /auth/me/workspaces ────────────────────────────────────────────────
export async function createWorkspace(
  body: WorkspaceCreate,
  getToken?: GetTokenFn,
): Promise<WorkspaceOut> {
  return apiFetch<WorkspaceOut>("/auth/me/workspaces", {
    method: "POST",
    json: body,
    getToken,
  });
}
