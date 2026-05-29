"use client";
import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Languages, Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTranslation, SUPPORTED_LANGUAGES } from "@/lib/i18n";

/**
 * Compact language picker for the header. Shows the active language's
 * endonym and lets the user switch between English / Hindi / Bengali.
 * Selection is persisted by the i18n provider (localStorage), so the
 * choice survives reloads and applies across every page.
 */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active =
    SUPPORTED_LANGUAGES.find((l) => l.code === lang) ?? SUPPORTED_LANGUAGES[0];

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("header.selectLanguage")}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-white/[0.07] hover:border-fin-500/30 hover:bg-white/5 transition-colors text-xs text-muted-foreground hover:text-foreground"
      >
        <Languages className="w-3.5 h-3.5 text-fin-400" />
        <span className="hidden sm:block font-medium">{active.nativeLabel}</span>
        <ChevronDown
          className={cn(
            "w-3 h-3 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1.5 w-44 z-50 rounded-xl border border-white/10 bg-popover shadow-2xl overflow-hidden py-1"
          >
            <li className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">
              {t("header.language")}
            </li>
            {SUPPORTED_LANGUAGES.map((l) => {
              const selected = l.code === lang;
              return (
                <li key={l.code} role="option" aria-selected={selected}>
                  <button
                    onClick={() => {
                      setLang(l.code);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "bg-fin-500/10 text-fin-300"
                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                    )}
                  >
                    <span className="text-base leading-none">{l.flag}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium truncate">{l.nativeLabel}</span>
                      <span className="block text-[10px] text-muted-foreground/70 truncate">
                        {l.label}
                      </span>
                    </span>
                    {selected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
