"use client";
import React from "react";
import { Sidebar } from "./Sidebar";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

/** Sidebar widths — must match the values animated inside <Sidebar />. */
const SIDEBAR_WIDTH_EXPANDED = 220;
const SIDEBAR_WIDTH_COLLAPSED = 64;

export function AppLayout({ children }: { children: React.ReactNode }) {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);

  const sidebarWidth = sidebarCollapsed
    ? SIDEBAR_WIDTH_COLLAPSED
    : SIDEBAR_WIDTH_EXPANDED;

  return (
    <div className="relative flex h-screen overflow-hidden">
      <Sidebar />

      {/* Collapse toggle — rendered at the layout level (not inside the
          overflow-hidden <Sidebar />) so the full circle is visible and sits
          cleanly in the gutter on the sidebar/content border instead of being
          clipped or overlapping page content. Its horizontal position tracks
          the sidebar width with the same spring as the sidebar animation. */}
      <motion.button
        type="button"
        aria-label="Toggle sidebar"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        initial={false}
        animate={{ left: sidebarWidth }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="absolute top-[76px] z-40 -translate-x-1/2 w-6 h-6 rounded-full border border-white/10 bg-card flex items-center justify-center hover:border-fin-500/40 hover:bg-fin-500/10 transition-colors duration-200 shadow-md"
      >
        {sidebarCollapsed ? (
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronLeft className="w-3 h-3 text-muted-foreground" />
        )}
      </motion.button>

      <motion.main
        className="flex-1 overflow-auto min-w-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        {children}
      </motion.main>
    </div>
  );
}
