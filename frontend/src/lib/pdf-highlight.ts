/**
 * Excerpt highlighting for react-pdf — Phase 4 Week 7 Day 5-7.
 *
 * After react-pdf renders the text layer of a page (a flat list of
 * absolutely-positioned <span>s), we walk the spans and tag any that
 * appear in the cited excerpt. The CSS class `phase4-cite-highlight`
 * (defined in globals.css) gives them the citation tint.
 *
 * The matcher is intentionally fuzzy:
 *   - Tokens are lowercased and stripped of punctuation
 *   - We require at least one trigram (3 consecutive tokens from the
 *     excerpt) to appear in a single span — single-word matches would
 *     create noisy false positives in long financial documents
 *   - Stop words alone never count as a match
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "at",
  "by", "with", "as", "is", "was", "were", "be", "been", "are", "this",
  "that", "it", "its", "from", "we", "our", "their", "they", "have",
  "has", "had", "but", "not", "no", "so", "if", "than", "then", "such",
  "any", "all", "may", "can", "will", "would", "could", "should", "do",
  "does", "did", "due", "per", "via", "into", "over", "under", "more",
  "less", "i", "you", "he", "she",
]);

/** Tokenize a string into a list of clean lowercase words. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s$%.-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function meaningful(tokens: string[]): string[] {
  return tokens.filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Build the trigram set from a cited excerpt that we'll match against
 * each text-layer span.
 *
 * Returns a set of 3-token strings ("revenue 383 billion", etc.).
 * Discards trigrams composed entirely of stop words.
 */
export function buildExcerptTrigrams(excerpt: string): Set<string> {
  const tokens = tokenize(excerpt);
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= tokens.length; i++) {
    const tri = [tokens[i], tokens[i + 1], tokens[i + 2]];
    if (meaningful(tri).length === 0) continue;
    grams.add(tri.join(" "));
  }
  // Also accept bigrams of meaningful words for short excerpts
  if (grams.size < 3) {
    const meaningfulTokens = meaningful(tokens);
    for (let i = 0; i + 2 <= meaningfulTokens.length; i++) {
      grams.add(`${meaningfulTokens[i]} ${meaningfulTokens[i + 1]}`);
    }
  }
  return grams;
}

/**
 * Walk every text-layer span inside `container` and add the highlight
 * CSS class whenever its text contains a trigram from `excerpt`.
 *
 * Returns the first highlighted element so the caller can scroll it
 * into view.
 */
export function highlightExcerpt(
  container: HTMLElement | null,
  excerpt: string
): HTMLElement | null {
  if (!container || !excerpt) return null;

  const grams = buildExcerptTrigrams(excerpt);
  if (grams.size === 0) return null;

  // Clear any previous highlights from a prior excerpt
  container
    .querySelectorAll<HTMLElement>(".phase4-cite-highlight")
    .forEach((el) => el.classList.remove("phase4-cite-highlight"));

  const spans = container.querySelectorAll<HTMLElement>("span");
  let firstMatch: HTMLElement | null = null;

  spans.forEach((span) => {
    const text = span.textContent ?? "";
    if (text.length < 8) return;

    const norm = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s$%.-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    for (const gram of grams) {
      if (norm.includes(gram)) {
        span.classList.add("phase4-cite-highlight");
        if (!firstMatch) firstMatch = span;
        break;
      }
    }
  });

  return firstMatch;
}
