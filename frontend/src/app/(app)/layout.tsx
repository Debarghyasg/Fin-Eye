"use client";
/**
 * (app) route group layout — wraps every authenticated page.
 *
 * Bug fixed: the original layout had no auth guard, so unauthenticated
 * users who hit /dashboard directly could see the app shell. Now we
 * check Clerk's auth state and redirect to /sign-in if the user is not
 * signed in. A loading spinner is shown while Clerk hydrates to prevent
 * any flash of the protected UI.
 */
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { DocumentViewer } from "@/components/workspace/DocumentViewer";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in");
    }
  }, [isLoaded, isSignedIn, router]);

  // While Clerk is loading, show a minimal spinner so the user doesn't
  // see the app shell for a fraction of a second before the redirect fires.
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-fin-500/30 border-t-fin-400 rounded-full animate-spin" />
      </div>
    );
  }

  // If not signed in, render nothing while the redirect is in-flight.
  if (!isSignedIn) return null;

  return (
    <QueryProvider>
      <AppLayout>{children}</AppLayout>
      <DocumentViewer />
    </QueryProvider>
  );
}
