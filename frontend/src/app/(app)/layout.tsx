import { AppLayout } from "@/components/layout/AppLayout";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { DocumentViewer } from "@/components/workspace/DocumentViewer";

/**
 * (app) route group layout — wraps every authenticated page.
 *
 *   QueryProvider     — shared React Query client (Phase 4 task #1)
 *   AppLayout         — sidebar + main scroll area
 *   DocumentViewer    — globally-mounted PDF dialog. It only renders
 *                       its content when `activeSource` is set on the
 *                       store, so it costs nothing on pages that
 *                       don't need it.
 */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AppLayout>{children}</AppLayout>
      <DocumentViewer />
    </QueryProvider>
  );
}
