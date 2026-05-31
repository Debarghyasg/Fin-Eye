"use client";
/**
 * Root route — redirect based on Clerk auth state.
 *
 * Bug fixed: previously redirected every visitor straight to /dashboard
 * regardless of whether they were signed in. Now:
 *   - Signed in  → /home
 *   - Not signed in → /sign-in
 *
 * useAuth() returns isLoaded=false on the first render (Clerk is hydrating).
 * We show nothing until it is loaded to avoid a flash-redirect.
 */
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function RootPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return; // wait for Clerk to hydrate
    if (isSignedIn) {
      router.replace("/home");
    } else {
      router.replace("/sign-in");
    }
  }, [isLoaded, isSignedIn, router]);

  // Show nothing while Clerk loads — avoids a white flash
  return null;
}
