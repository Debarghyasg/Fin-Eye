"use client";
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
    if (!isSignedIn) router.replace("/sign-in");
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-fin-500/30 border-t-fin-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSignedIn) return null;

  return (
    <QueryProvider>
      <AppLayout>{children}</AppLayout>
      <DocumentViewer />
    </QueryProvider>
  );
}