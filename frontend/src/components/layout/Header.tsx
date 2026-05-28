"use client";
import React from "react";
import { motion } from "framer-motion";
import { Search, Bell, Shield, ChevronDown, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/useAppStore";
import { IS_LIVE_API } from "@/lib/api/client";

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const alerts = useAppStore((s) => s.alerts);
  const unread = alerts.filter((a) => !a.read).length;

  return (
    <>
      {/* ── Mock-mode warning banner ──────────────────────────────────────── */}
      {!IS_LIVE_API && (
        <div className="w-full bg-amber-500/15 border-b border-amber-500/30 px-6 py-2 flex items-center gap-2 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            <strong>Mock mode — not connected to the database.</strong>{" "}
            Create <code className="font-mono bg-amber-500/10 px-1 rounded">frontend/.env.local</code> with{" "}
            <code className="font-mono bg-amber-500/10 px-1 rounded">NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1</code>{" "}
            and restart the frontend.
          </span>
        </div>
      )}

      <header className="h-16 border-b border-white/[0.07] flex items-center justify-between px-6 bg-background/60 backdrop-blur-xl sticky top-0 z-20">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground -mt-0.5">{subtitle}</p>}
        </motion.div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search documents, queries…"
              className="w-60 pl-9 h-8 text-xs"
            />
          </div>

          {/* Alerts bell */}
          <Button variant="ghost" size="icon-sm" className="relative">
            <Bell className="w-4 h-4" />
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute top-1 right-1 w-2 h-2 rounded-full bg-fin-400"
              />
            )}
          </Button>

          {/* Compliance badge */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-fin-500/10 border border-fin-500/20">
            <Shield className="w-3 h-3 text-fin-400" />
            <span className="text-xs text-fin-300 font-medium">SEC Compliant</span>
          </div>

          {/* User */}
          <button className="flex items-center gap-2 pl-3 border-l border-white/[0.07]">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-fin-400 to-fin-700 flex items-center justify-center text-xs font-bold text-white">
              DS
            </div>
            <span className="text-sm text-muted-foreground hidden md:block">Debarghya</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground hidden md:block" />
          </button>
        </div>
      </header>
    </>
  );
}
