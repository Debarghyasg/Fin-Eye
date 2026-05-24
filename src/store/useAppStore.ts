import { create } from "zustand";
import { mockDocuments, mockQueryHistory, mockAlerts } from "@/lib/mock-data";

export type Document = (typeof mockDocuments)[number];
export type QueryEntry = (typeof mockQueryHistory)[number];
export type Alert = (typeof mockAlerts)[number];

interface AppState {
  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;

  // Documents
  documents: Document[];
  addDocument: (doc: Document) => void;
  removeDocument: (id: string) => void;

  // Query
  queryHistory: QueryEntry[];
  addQuery: (q: QueryEntry) => void;
  isQuerying: boolean;
  setIsQuerying: (v: boolean) => void;

  // Alerts
  alerts: Alert[];
  markAlertRead: (id: string) => void;
  unreadCount: () => number;

  // Active document for workspace
  activeDocId: string | null;
  setActiveDocId: (id: string | null) => void;

  // Upload state
  uploadProgress: Record<string, number>;
  setUploadProgress: (id: string, pct: number) => void;
  clearUpload: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

  documents: mockDocuments,
  addDocument: (doc) => set((s) => ({ documents: [doc, ...s.documents] })),
  removeDocument: (id) => set((s) => ({ documents: s.documents.filter((d) => d.id !== id) })),

  queryHistory: mockQueryHistory,
  addQuery: (q) => set((s) => ({ queryHistory: [q, ...s.queryHistory] })),
  isQuerying: false,
  setIsQuerying: (v) => set({ isQuerying: v }),

  alerts: mockAlerts,
  markAlertRead: (id) =>
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)),
    })),
  unreadCount: () => get().alerts.filter((a) => !a.read).length,

  activeDocId: null,
  setActiveDocId: (id) => set({ activeDocId: id }),

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
