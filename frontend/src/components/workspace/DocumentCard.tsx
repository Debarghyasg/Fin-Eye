"use client";
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Trash2, MoreVertical, ExternalLink,
  CheckCircle2, Loader2, Clock, Tag, ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatBytes, relativeTime } from "@/lib/utils";
import type { Document } from "@/store/useAppStore";
import { useAppStore } from "@/store/useAppStore";

const statusConfig = {
  indexed: { label: "Indexed", icon: CheckCircle2, variant: "success" as const, color: "text-emerald-400" },
  processing: { label: "Processing", icon: Loader2, variant: "processing" as const, color: "text-violet-400" },
  failed: { label: "Failed", icon: Clock, variant: "destructive" as const, color: "text-red-400" },
};

export function DocumentCard({ doc, onClick, active }: { doc: Document; onClick: () => void; active: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const removeDocument = useAppStore((s) => s.removeDocument);
  const cfg = statusConfig[doc.status as keyof typeof statusConfig] || statusConfig.processing;
  const StatusIcon = cfg.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -1 }}
      onClick={onClick}
      className={cn(
        "relative rounded-xl border p-4 cursor-pointer transition-all duration-200 group",
        active
          ? "border-fin-500/40 bg-fin-500/10 shadow-[0_0_20px_rgba(34,162,105,0.1)]"
          : "border-white/[0.07] bg-card hover:border-white/[0.14] hover:bg-white/[0.03]"
      )}
    >
      {/* Active glow edge */}
      {active && (
        <motion.div
          layoutId="doc-active"
          className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-fin-400"
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
            active ? "bg-fin-500/20" : "bg-white/[0.05] group-hover:bg-fin-500/10"
          )}>
            <FileText className={cn("w-5 h-5 transition-colors", active ? "text-fin-400" : "text-muted-foreground group-hover:text-fin-400")} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{doc.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground">{doc.ticker}</span>
              <span className="text-white/20">·</span>
              <span className="text-xs text-muted-foreground">{doc.type}</span>
              <span className="text-white/20">·</span>
              <span className="text-xs text-muted-foreground">{doc.pages}pp</span>
            </div>
          </div>
        </div>

        {/* Menu */}
        <div className="relative flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded-md hover:bg-white/10 flex items-center justify-center"
          >
            <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -5 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-8 w-36 z-50 rounded-lg border border-white/10 bg-popover shadow-xl py-1"
                onClick={(e) => e.stopPropagation()}
              >
                <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
                  <ExternalLink className="w-3 h-3" /> View PDF
                </button>
                <button
                  onClick={() => { removeDocument(doc.id); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05]">
        <div className="flex items-center gap-1.5">
          <StatusIcon className={cn("w-3 h-3", cfg.color, doc.status === "processing" && "animate-spin")} />
          <span className={cn("text-xs", cfg.color)}>{cfg.label}</span>
          {doc.status === "indexed" && (
            <span className="text-xs text-muted-foreground">· {(doc.confidence * 100).toFixed(0)}% conf.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{relativeTime(doc.uploadedAt)}</span>
          <span className="text-xs text-muted-foreground">{formatBytes(doc.size)}</span>
        </div>
      </div>

      {/* Tags */}
      {doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {doc.tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.05] text-muted-foreground">
              <Tag className="w-2.5 h-2.5" />{tag}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
