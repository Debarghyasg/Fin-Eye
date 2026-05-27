"use client";
/**
 * Shared workspace-ID resolver.
 *
 * Every page that needs a workspace_id (workspace, query, alerts,
 * analytics, comparisons) used to either read NEXT_PUBLIC_DEFAULT_WORKSPACE_ID
 * or fall back to the literal string "default" — both of which break against
 * a real backend because Postgres doesn't have a row with that ID.
 *
 * This hook resolves the user's actual workspace UUID by:
 *   1. Honouring NEXT_PUBLIC_DEFAULT_WORKSPACE_ID when the operator pinned
 *      a specific workspace via env var (useful for power users with
 *      multiple workspaces).
 *   2. Falling back to the first workspace returned by GET /auth/me/workspaces.
 *      The backend auto-creates a default workspace on first sign-in, so
 *      this is the normal path for fresh accounts.
 *
 * Returns `null` while the lookup is in flight or when offline mode is on.
 * Components should branch on `IS_LIVE_API && !!workspaceId` before issuing
 * any backend call that requires it.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";

import { IS_LIVE_API, apiFetch } from "./api/client";

interface WorkspaceSummary {
  id: string;
  name: string;
}

export function useWorkspaceId(): string | null {
  const { getToken, isSignedIn } = useAuth();

  const fromEnv = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_ID;

  // React Query handles caching + dedup so every page calling this hook
  // hits the endpoint at most once per session.
  const { data } = useQuery<WorkspaceSummary[]>({
    queryKey: ["my-workspaces"],
    queryFn: () =>
      apiFetch<WorkspaceSummary[]>("/auth/me/workspaces", { getToken }),
    // Skip the fetch entirely when offline mode is on or the user isn't
    // signed in — there's no JWT to authenticate the call anyway.
    enabled: IS_LIVE_API && !!isSignedIn && !fromEnv,
    staleTime: Infinity,
    retry: 1,
  });

  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return data?.[0]?.id ?? null;
}
