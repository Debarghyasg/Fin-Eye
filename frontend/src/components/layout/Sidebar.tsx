"use client";
import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import {
  LayoutDashboard, FileText, GitCompare, Bell, Settings,
  ChevronLeft, ChevronRight, BarChart3, Shield, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useClerk } from "@clerk/nextjs";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Workspace", href: "/workspace", icon: FileText },
  { label: "Compare", href: "/compare", icon: GitCompare },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Alerts", href: "/alerts", icon: Bell },
  { label: "Audit", href: "/audit", icon: Shield },
];

const bottomItems = [
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarCollapsed, setSidebarCollapsed, alerts, documents } = useAppStore();
  const { signOut } = useClerk();
  const unread = alerts.filter((a) => !a.read).length;
  const indexedCount = documents.filter((d) => d.status === "indexed").length;

  const handleSignOut = async () => {
    await signOut();
    router.push("/sign-in");
  };

  return (
    <TooltipProvider delayDuration={200}>
      <motion.aside
        animate={{ width: sidebarCollapsed ? 64 : 220 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative flex flex-col h-screen border-r border-white/[0.07] bg-card/60 backdrop-blur-xl z-30 overflow-hidden"
      >
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center h-16 px-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center">
              <Image
                src="/logo-mark.svg"
                alt="Fin-Sight"
                width={36}
                height={36}
                className="drop-shadow-[0_0_10px_rgba(34,162,105,0.45)]"
                priority
              />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-fin-300 animate-pulse-glow" />
            </div>
            <AnimatePresence>
              {!sidebarCollapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.2 }}
                  className="font-bold text-base whitespace-nowrap tracking-tight overflow-hidden font-serif"
                  style={{ fontFamily: "'Cinzel', 'Playfair Display', Georgia, serif" }}
                >
                  Fin<span className="text-slate-400">-</span>Sight
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            const isAlerts = item.href === "/alerts";

            const navLink = (
              <Link key={item.href} href={item.href}>
                <motion.div
                  whileHover={{ x: sidebarCollapsed ? 0 : 2 }}
                  whileTap={{ scale: 0.97 }}
                  className={cn(
                    "relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors duration-200 group",
                    isActive
                      ? "bg-fin-500/15 text-fin-300"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-nav"
                      className="absolute inset-0 rounded-lg bg-fin-500/10 border border-fin-500/20"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <div className="relative z-10 flex-shrink-0">
                    <Icon className="w-[18px] h-[18px]" />
                    {isAlerts && unread > 0 && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-fin-500 text-[9px] font-bold flex items-center justify-center text-white leading-none">
                        {unread}
                      </span>
                    )}
                  </div>
                  <AnimatePresence>
                    {!sidebarCollapsed && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "auto" }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.15 }}
                        className="relative z-10 overflow-hidden whitespace-nowrap"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {!sidebarCollapsed && isAlerts && unread > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="ml-auto relative z-10 bg-fin-500/20 text-fin-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    >
                      {unread}
                    </motion.span>
                  )}
                </motion.div>
              </Link>
            );

            if (sidebarCollapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{navLink}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }
            return navLink;
          })}
        </nav>

        {/* Bottom section */}
        <div className="py-4 px-2 border-t border-white/[0.07] space-y-1">
          {/* Live indicator */}
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mx-1 mb-3 px-3 py-2 rounded-lg bg-fin-500/10 border border-fin-500/20"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-fin-400 animate-pulse" />
                  <span className="text-xs text-fin-300 font-medium">AI Pipeline Live</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {indexedCount} doc{indexedCount === 1 ? "" : "s"} indexed
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {bottomItems.map((item) => {
            const Icon = item.icon;
            const link = (
              <Link key={item.href} href={item.href}>
                <motion.div
                  whileHover={{ x: sidebarCollapsed ? 0 : 2 }}
                  className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors duration-200"
                >
                  <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                  <AnimatePresence>
                    {!sidebarCollapsed && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="whitespace-nowrap"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              </Link>
            );
            if (sidebarCollapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }
            return link;
          })}

          {/* Sign Out */}
          {sidebarCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center justify-center rounded-lg px-2.5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors duration-200"
                >
                  <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign Out</TooltipContent>
            </Tooltip>
          ) : (
            <motion.button
              whileHover={{ x: 2 }}
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors duration-200"
            >
              <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
              <span className="whitespace-nowrap">Sign Out</span>
            </motion.button>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full border border-white/10 bg-card flex items-center justify-center hover:border-fin-500/40 hover:bg-fin-500/10 transition-all duration-200 z-40"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronLeft className="w-3 h-3 text-muted-foreground" />
          )}
        </button>
      </motion.aside>
    </TooltipProvider>
  );
}