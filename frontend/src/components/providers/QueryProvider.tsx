"use client";
/**
 * React Query provider — Phase 4 frontend wiring.
 *
 * Wraps the (app) route group so all live-data hooks share a single
 * QueryClient instance. Keep configuration conservative:
 *   - 30s staleTime: matches our typical alert polling cadence
 *   - retry once on network errors (don't hammer the backend)
 *   - DevTools enabled in development for visibility into the cache
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Lazy-init so the client survives Fast Refresh in dev
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: (failureCount, error) => {
              // Don't retry 4xx errors — they won't recover
              const status = (error as { status?: number })?.status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 1;
            },
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
