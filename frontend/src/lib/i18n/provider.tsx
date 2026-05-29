"use client";
/**
 * Lightweight, dependency-free i18n for Fin-Sight.
 *
 * Why not next-intl / i18next?
 *   The app uses the Next.js App Router with Clerk middleware and a flat
 *   route structure (no `[locale]` segment). Introducing locale-prefixed
 *   routing would mean restructuring every route and reworking the Clerk
 *   matcher. Instead we keep a client-side language context backed by
 *   localStorage — language switches are instant, require no navigation,
 *   and persist across reloads.
 *
 * Usage:
 *   const { t, lang, setLang } = useTranslation();
 *   <h1>{t("dashboard.title")}</h1>
 *   <p>{t("nav.docsIndexed", { count: 3 })}</p>
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { translations, type Language } from "./translations";

export const SUPPORTED_LANGUAGES: Array<{
  code: Language;
  label: string;
  /** Endonym — the language's own name. */
  nativeLabel: string;
  flag: string;
}> = [
  { code: "en", label: "English", nativeLabel: "English", flag: "🇬🇧" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी", flag: "🇮🇳" },
  { code: "bn", label: "Bengali", nativeLabel: "বাংলা", flag: "🇧🇩" },
];

const STORAGE_KEY = "fin-sight-lang";
const DEFAULT_LANG: Language = "en";

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** Resolve a dot-separated key against a flat dictionary. */
function lookup(dict: Record<string, string>, key: string): string | undefined {
  return dict[key];
}

/** Replace {placeholders} with provided values. */
function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(DEFAULT_LANG);

  // Hydrate the saved language on mount (client-only).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as Language | null;
      if (saved && saved in translations) {
        setLangState(saved);
        document.documentElement.lang = saved;
      }
    } catch {
      /* localStorage unavailable — fall back to default */
    }
  }, []);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence errors */
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const active = translations[lang] ?? translations[DEFAULT_LANG];
      const fallback = translations[DEFAULT_LANG];
      const value = lookup(active, key) ?? lookup(fallback, key) ?? key;
      return interpolate(value, vars);
    },
    [lang],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t }),
    [lang, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Defensive fallback so a component rendered outside the provider
    // (e.g. in isolation) doesn't crash — it just renders English keys.
    return {
      lang: DEFAULT_LANG,
      setLang: () => {},
      t: (key, vars) =>
        interpolate(
          translations[DEFAULT_LANG][key] ?? key,
          vars,
        ),
    };
  }
  return ctx;
}
