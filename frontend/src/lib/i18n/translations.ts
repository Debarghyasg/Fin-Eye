/**
 * i18n translation registry.
 *
 * Each language is a flat `Record<string, string>` keyed by dot-separated
 * paths (see en.ts for the canonical key set). The provider resolves a key
 * against the active language and falls back to English when a key is
 * missing, so partial translations degrade gracefully.
 */
import { en } from "./en";
import { hi } from "./hi";
import { bn } from "./bn";

export type Language = "en" | "hi" | "bn";

export const translations: Record<Language, Record<string, string>> = {
  en,
  hi,
  bn,
};
