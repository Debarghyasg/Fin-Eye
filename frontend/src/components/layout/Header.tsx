"use client";
import React from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { Bell, Shield, ChevronDown, Activity, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { IS_LIVE_API, getApiHealth, type ApiHealthResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useTranslation } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const alerts = useAppStore((s) => s.alerts);
  const unread = alerts.filter((a) => !a.read).length;
  const { t } = useTranslation();

  return (
    <>
      {!IS_LIVE_API && (
        <div className="w-full bg-amber-500/15 border-b border-amber-500/30 px-6 py-2 flex items-center gap-2 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            <strong>{t("header.mockMode")}</strong>{" "}
            {t("header.mockModeCreate")}{" "}
            <code className="font-mono bg-amber-500/10 px-1 rounded">frontend/.env.local</code>{" "}
            {t("header.mockModeWith")}{" "}
            <code className="font-mono bg-amber-500/10 px-1 rounded">NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1</code>{" "}
            {t("header.mockModeRestart")}
          </span>
        </div>
      )}

      <header className="h-16 border-b border-white/[0.07] flex items-center justify-between px-6 bg-background/60 backdrop-blur-xl sticky top-0 z-20">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground -mt-0.5">{subtitle}</p>}
        </motion.div>

        <div className="flex items-center gap-2">
          <LanguageSwitcher />

          <ApiHealthDot />

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

          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-fin-500/10 border border-fin-500/20">
            <Shield className="w-3 h-3 text-fin-400" />
            <span className="text-xs text-fin-300 font-medium">{t("header.secCompliant")}</span>
          </div>

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

function ApiHealthDot() {
  const { getToken } = useAuth();
  const { t } = useTranslation();

  const healthQuery = useQuery<ApiHealthResponse>({
    queryKey: ["api-health"],
    queryFn: () => getApiHealth(getToken),
    enabled: IS_LIVE_API,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });

  const visual = (() => {
    if (!IS_LIVE_API) return { dot: "bg-slate-500", ping: false, label: t("health.mockMode") };
    if (healthQuery.isLoading) return { dot: "bg-slate-400", ping: false, label: t("health.checking") };
    if (healthQuery.isError || !healthQuery.data) return { dot: "bg-red-500", ping: true, label: t("health.unreachable") };
    if (healthQuery.data.status === "ok") return { dot: "bg-emerald-400", ping: true, label: t("health.healthy") };
    if (healthQuery.data.status === "degraded") return { dot: "bg-amber-400", ping: true, label: t("health.degraded") };
    return { dot: "bg-red-500", ping: true, label: `API ${healthQuery.data.status}` };
  })();

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => healthQuery.refetch()}
            className="relative flex items-center justify-center w-7 h-7 rounded-md hover:bg-white/5 transition-colors"
            aria-label={`API status: ${visual.label}`}
          >
            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="absolute top-1 right-1">
              <span className={cn("block w-2 h-2 rounded-full", visual.dot)} />
              {visual.ping && (
                <span className={cn("absolute inset-0 w-2 h-2 rounded-full animate-ping opacity-50", visual.dot)} />
              )}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="text-xs">
          <p className="font-medium">{visual.label}</p>
          {healthQuery.data && (
            <>
              <p className="text-muted-foreground mt-0.5">{t("health.dbLabel")}: <span className="font-mono">{healthQuery.data.database}</span></p>
              <p className="text-muted-foreground">v{healthQuery.data.version} · {healthQuery.data.environment}</p>
            </>
          )}
          {!IS_LIVE_API && (
            <p className="text-muted-foreground mt-0.5">
              {t("health.enablePrefix")} <code className="text-fin-300">NEXT_PUBLIC_API_URL</code> {t("health.enableSuffix")}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}