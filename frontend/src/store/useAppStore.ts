import { create } from "zustand";
// NOTE: mock-data is imported for its TYPE shapes only (Document / QueryEntry /
// Alert are derived via `typeof`). No mock values are seeded into the store —
// all data is hydrated from the live backend.
import { mockDocuments, mockQueryHistory, mockAlerts } from "@/lib/mock-data";

export type Document = (typeof mockDocuments)[number];
export type QueryEntry = (typeof mockQueryHistory)[number];
export type Alert = (typeof mockAlerts)[number];

/**
 * A clicked source from the SourcesPanel that should open in the document
 * viewer modal. `excerpt` is highlighted by the viewer overlay.
 */
export interface ActiveSource {
  docId: string;
  page: number;
  excerpt: string;
}

interface AppState {
  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;

  // Workspace sources panel (right rail) visibility
  sourcesPanelOpen: boolean;
  setSourcesPanelOpen: (v: boolean) => void;
  toggleSourcesPanel: () => void;

  // Documents
  documents: Document[];
  addDocument: (doc: Document) => void;
  removeDocument: (id: string) => void;
  updateDocument: (id: string, patch: Partial<Document>) => void;

  // Query
  queryHistory: QueryEntry[];
  addQuery: (q: QueryEntry) => void;
  removeQuery: (id: string) => void;
  clearQueries: () => void;
  isQuerying: boolean;
  setIsQuerying: (v: boolean) => void;

  // Alerts
  alerts: Alert[];
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;
  unreadCount: () => number;
  addAlert: (a: Alert) => void;

  // Active document for the workspace right-rail / viewer
  activeDocId: string | null;
  setActiveDocId: (id: string | null) => void;

  // ── Phase 4 additions ────────────────────────────────────────────────────
  /**
   * Document IDs the user has multi-selected to scope queries to.
   * Empty array means "query across all indexed documents".
   */
  selectedDocIds: string[];
  toggleSelectedDoc: (id: string) => void;
  setSelectedDocIds: (ids: string[]) => void;
  clearSelectedDocs: () => void;

  /**
   * The source the user clicked in the SourcesPanel — used to open the
   * react-pdf document viewer dialog at the cited page with the excerpt
   * visually highlighted.
   */
  activeSource: ActiveSource | null;
  setActiveSource: (s: ActiveSource | null) => void;

  // Upload state
  uploadProgress: Record<string, number>;
  setUploadProgress: (id: string, pct: number) => void;
  clearUpload: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

  sourcesPanelOpen: true,
  setSourcesPanelOpen: (v) => set({ sourcesPanelOpen: v }),
  toggleSourcesPanel: () => set((s) => ({ sourcesPanelOpen: !s.sourcesPanelOpen })),

  // Start empty — the workspace is hydrated exclusively from the live
  // backend (see workspace/page.tsx). No preexisting/sample documents.
  documents: [],
  addDocument: (doc) => set((s) => ({ documents: [doc, ...s.documents] })),
  removeDocument: (id) =>
    set((s) => ({
      documents: s.documents.filter((d) => d.id !== id),
      selectedDocIds: s.selectedDocIds.filter((d) => d !== id),
      activeDocId: s.activeDocId === id ? null : s.activeDocId,
    })),
  updateDocument: (id, patch) =>
    set((s) => ({
      documents: s.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),

  // Start empty — query history is hydrated from the backend.
  queryHistory: [],
  addQuery: (q) => set((s) => ({ queryHistory: [q, ...s.queryHistory] })),
  // Remove a single chat turn from the in-view history. Note: backend
  // query_logs are an immutable SEC 17a-4 audit trail and are never deleted;
  // this only hides the turn from the current chat view.
  removeQuery: (id) =>
    set((s) => ({ queryHistory: s.queryHistory.filter((q) => q.id !== id) })),
  clearQueries: () => set({ queryHistory: [] }),
  isQuerying: false,
  setIsQuerying: (v) => set({ isQuerying: v }),

  // Start empty — alerts are loaded from the live /alerts endpoint.
  alerts: [],
  markAlertRead: (id) =>
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)),
    })),
  markAllAlertsRead: () =>
    set((s) => ({ alerts: s.alerts.map((a) => ({ ...a, read: true })) })),
  unreadCount: () => get().alerts.filter((a) => !a.read).length,
  addAlert: (a) => set((s) => ({ alerts: [a, ...s.alerts] })),

  activeDocId: null,
  setActiveDocId: (id) => set({ activeDocId: id }),

  selectedDocIds: [],
  toggleSelectedDoc: (id) =>
    set((s) => ({
      selectedDocIds: s.selectedDocIds.includes(id)
        ? s.selectedDocIds.filter((d) => d !== id)
        : [...s.selectedDocIds, id],
    })),
  setSelectedDocIds: (ids) => set({ selectedDocIds: ids }),
  clearSelectedDocs: () => set({ selectedDocIds: [] }),

  activeSource: null,
  setActiveSource: (s) => set({ activeSource: s }),

  uploadProgress: {},
  setUploadProgress: (id, pct) =>
    set((s) => ({ uploadProgress: { ...s.uploadProgress, [id]: pct } })),
  clearUpload: (id) =>
    set((s) => {
      const next = { ...s.uploadProgress };
      delete next[id];
      return { uploadProgress: next };
    }),
}));
