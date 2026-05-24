"use client";
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  change?: number;
  changeLabel?: string;
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  index?: number;
  gradient?: boolean;
}

export function StatCard({
  title,
  value,
  unit,
  change,
  changeLabel,
  icon: Icon,
  iconColor = "text-fin-400",
  iconBg = "bg-fin-500/10",
  index = 0,
  gradient = false,
}: StatCardProps) {
  const isPositive = (change ?? 0) > 0;
  const isFlat = change === undefined || Math.abs(change) < 0.1;
  const DeltaIcon = isFlat ? Minus : isPositive ? TrendingUp : TrendingDown;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.07 }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "gradient-card p-5 cursor-default",
        gradient && "bg-gradient-to-br from-fin-900/80 to-fin-950/80"
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", iconBg)}>
          <Icon className={cn("w-4.5 h-4.5 w-[18px] h-[18px]", iconColor)} />
        </div>
      </div>

      <div className="flex items-end gap-1.5">
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: index * 0.07 + 0.2 }}
          className="text-2xl font-bold text-foreground leading-none"
        >
          {value}
        </motion.span>
        {unit && <span className="text-sm text-muted-foreground mb-0.5">{unit}</span>}
      </div>

      {change !== undefined && (
        <div className="flex items-center gap-1.5 mt-2">
          <div className={cn(
            "flex items-center gap-1 text-xs font-medium",
            isFlat ? "text-muted-foreground" : isPositive ? "text-emerald-400" : "text-red-400"
          )}>
            <DeltaIcon className="w-3 h-3" />
            {!isFlat && (isPositive ? "+" : "")}{change?.toFixed(1)}%
          </div>
          {changeLabel && (
            <span className="text-xs text-muted-foreground">{changeLabel}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}
