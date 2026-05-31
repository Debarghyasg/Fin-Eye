"""
LLM answer generator — FREE stack (Groq + Llama 3.3 70B).

Groq free tier
--------------
  - 14,400 requests/day
  - 6,000 tokens/minute
  - Model: llama-3.3-70b-versatile  (best quality; replaces the decommissioned llama-3.1-70b-versatile)
  - Fallback: llama-3.1-8b-instant  (faster, lower quality)
  - Sign up free at https://console.groq.com

Groq returns responses in ~0.3s — faster than GPT-4o.

System prompt
-------------
Same compliance-first prompt as the paid version:
- Answer ONLY from provided context
- Always cite sources with [N] notation
- Output valid JSON: { answer, citations, confidence }
"""
from __future__ import annotations

import asyncio
import json
import logging

from app.core.config import settings

log = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are FinSight AI, a financial document intelligence assistant.

RULES (follow strictly):
1. Answer ONLY using the numbered source context provided below.
2. If the answer is not in the context, respond: "I cannot find this information in the provided documents."
3. EVERY claim must reference a chunk by its document name and page number using [N] notation inline (e.g. "Revenue was $383B [1]").
4. Be precise with numbers — never round unless the source does.
5. For comparisons, explicitly state the periods being compared.
6. Citations must be specific to the exact information - don't cite multiple sources for a single fact unless all sources confirm it.

OUTPUT FORMAT — respond with valid JSON only, no markdown fences:
{
    "answer": "Your answer with inline citations like [1]",
    "citations": [
        {
            "chunk_id": "1",
            "page_number": 15,
            "excerpt": "Revenue increased by 12% to $383 billion",
            "document_name": "Apple 10-K 2023"
        }
    ],
    "confidence": 0.94
}

confidence scoring based on source agreement:
- 0.95-1.0: Multiple sources confirm the same fact explicitly
- 0.85-0.94: Single authoritative source states fact directly  
- 0.70-0.84: Reasonable inference from clear context
- 0.50-0.69: Mild inference with some uncertainty
- Below 0.50: Use cannot-find response"""


# Per-chunk size cap for the LLM context window. Prose chunks are ~800
# chars by design (see chunker.CHUNK_SIZE_CHARS), but TABLE chunks hold
# the entire table verbatim and can run several KB; the previous 800-char
# cap silently dropped the bottom rows of large income statements, which
# meant the generator would happily cite a partial table. Keep prose
# tight, give tables much more room.
_PROSE_CONTEXT_CHARS = 800
_TABLE_CONTEXT_CHARS = 4000


def _build_context(chunks: list[dict]) -> str:
    """Build context with document names and enhanced formatting for citations."""
    lines = []
    for i, chunk in enumerate(chunks, start=1):
        page = chunk.get("page_number")
        section = chunk.get("source_section", "")
        text = chunk.get("text", "")
        # Prefer the real filename injected by the retriever's join; fall
        # back to a short synthetic name only when the doc row is missing
        # (shouldn't happen, but keeps the prompt formatting consistent).
        document_name = chunk.get("document_name")
        if not document_name:
            doc_id = chunk.get("document_id", "")
            document_name = f"Document-{doc_id[:8]}" if doc_id else "Unknown document"

        # Tables get a larger window so the LLM can read every row. We
        # detect a table chunk via the chunk_type field if present, and
        # also via the [TABLE] sentinel the chunker emits as a safety net.
        chunk_type = chunk.get("chunk_type")
        chunk_type_str = (
            chunk_type.value if hasattr(chunk_type, "value") else str(chunk_type or "")
        ).lower()
        is_table = chunk_type_str == "table" or text.lstrip().startswith("[TABLE]")
        max_chars = _TABLE_CONTEXT_CHARS if is_table else _PROSE_CONTEXT_CHARS

        header = f"[{i}] Document: {document_name}"
        if page:
            header += f" | Page: {page}"
        if section:
            header += f" | Section: {section}"

        lines.append(header)
        lines.append(f'Content: "{text[:max_chars]}"')
        lines.append("")
    return "\n".join(lines)


def _call_groq(query: str, context: str, model: str) -> dict:
    """
    Call Groq API and parse JSON response.
    Raises ValueError on invalid JSON or API error.
    """
    from groq import Groq
    client = Groq(api_key=settings.GROQ_API_KEY)

    response = client.chat.completions.create(
        model=model,
        temperature=0.1,
        max_tokens=1500,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"CONTEXT DOCUMENTS:\n\n{context}\n\n"
                    f"QUESTION: {query}"
                ),
            },
        ],
    )

    raw = response.choices[0].message.content or "{}"

    # Strip any accidental markdown fences
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Groq returned invalid JSON: {raw[:200]}") from exc


async def generate_answer(
    query: str,
    reranked_chunks: list[dict],
    model: str | None = None,
) -> dict:
    """
    Generate a cited answer from reranked chunks using Groq.

    Returns:
        {
            "answer":     "...",
            "citations":  [{"chunk_id": "1", "page_number": 15, "excerpt": "...", "document_name": "..."}],
            "confidence": 0.91,
            "model_used": "llama-3.3-70b-versatile",
            "sources":    [{chunk_id, document_id, page_number, excerpt, score}, ...]
        }
    """
    if not settings.GROQ_API_KEY:
        raise RuntimeError(
            "GROQ_API_KEY is not set. "
            "Get a free key at https://console.groq.com and add it to backend/.env"
        )

    model = model or settings.GROQ_MODEL
    context = _build_context(reranked_chunks)

    # Primary model call
    try:
        result = await asyncio.to_thread(_call_groq, query, context, model)
    except Exception as exc:
        log.warning("Primary model %r failed (%s) — retrying with fallback", model, exc)
        try:
            result = await asyncio.to_thread(
                _call_groq, query, context, settings.GROQ_FALLBACK_MODEL
            )
            model = settings.GROQ_FALLBACK_MODEL
        except Exception as exc2:
            log.error("Both Groq models failed: %s", exc2)
            result = {
                "answer": "The AI service is temporarily unavailable. Please try again.",
                "citations": [],
                "confidence": 0.0,
            }

    answer = result.get("answer", "")
    raw_citations = result.get("citations", [])
    confidence = float(result.get("confidence", 0.0))

    def _safe_index(value) -> int | None:
        """Parse the LLM's chunk_id field to a 0-based reranked_chunks index.

        Tolerates string ints ("1"), ints (1), surrounding whitespace, and
        rejects anything else (e.g. UUIDs returned despite the prompt) so a
        stray response shape can't 500 the route.
        """
        try:
            n = int(str(value).strip())
        except (TypeError, ValueError):
            return None
        idx = n - 1  # LLM emits 1-based; reranked_chunks is 0-based
        if not 0 <= idx < len(reranked_chunks):
            return None
        return idx

    def _doc_name(chunk: dict) -> str:
        name = chunk.get("document_name")
        if name:
            return name
        doc_id = chunk.get("document_id", "")
        return f"Document-{doc_id[:8]}" if doc_id else "Unknown document"

    # ── Sources ───────────────────────────────────────────────────────────────
    # Build sources from the chunks ACTUALLY shown to the model, in order.
    #
    # Previously `sources` was derived solely from the model's self-reported
    # `citations` array. When the model wrote inline [N] markers in the answer
    # but returned an empty or malformed `citations` array (common, especially
    # on the 8B fallback), `sources` came back empty — so the UI showed bare
    # citation numbers with no excerpt/page/document behind them.
    #
    # The inline [N] markers are 1-based indices into the context numbering
    # produced by `_build_context`, which is exactly this `reranked_chunks`
    # order, so source N corresponds to [N]. Deriving sources here guarantees
    # the user always sees the underlying evidence.
    sources = []
    for chunk in reranked_chunks:
        text = chunk.get("text", "") or ""
        sources.append({
            "chunk_id": chunk.get("chunk_id", ""),
            "document_id": chunk.get("document_id", ""),
            "document_name": _doc_name(chunk),
            "page_number": chunk.get("page_number"),
            "excerpt": text[:300],
            "score": chunk.get("rerank_score", chunk.get("rrf_score", 0.0)),
        })

    # ── Citations ─────────────────────────────────────────────────────────────
    # The model's structured, per-claim references. Best-effort: tolerate dict
    # and legacy-int shapes, backfill blank fields from the chunk, and skip
    # anything unparseable. `sources` above already guarantees evidence, so a
    # missing/garbled citations array no longer hides the source data.
    processed_citations = []
    for citation in (raw_citations or []):
        if isinstance(citation, dict):
            array_idx = _safe_index(citation.get("chunk_id", "0"))
            if array_idx is None:
                log.debug(
                    "Skipping citation with unparseable chunk_id=%r",
                    citation.get("chunk_id"),
                )
                continue
            chunk = reranked_chunks[array_idx]
            processed_citations.append({
                "chunk_id": str(array_idx + 1),
                "page_number": citation.get("page_number", chunk.get("page_number")),
                "excerpt": citation.get("excerpt") or (chunk.get("text", "") or "")[:200],
                "document_name": citation.get("document_name") or _doc_name(chunk),
            })
        else:
            array_idx = _safe_index(citation)
            if array_idx is None:
                log.debug("Skipping unparseable legacy citation %r", citation)
                continue
            chunk = reranked_chunks[array_idx]
            processed_citations.append({
                "chunk_id": str(array_idx + 1),
                "page_number": chunk.get("page_number"),
                "excerpt": (chunk.get("text", "") or "")[:200],
                "document_name": _doc_name(chunk),
            })

    log.info(
        "Generation: model=%s confidence=%.2f citations=%d sources=%d",
        model, confidence, len(processed_citations), len(sources),
    )

    return {
        "answer": answer,
        "citations": processed_citations,
        "confidence": confidence,
        "model_used": model,
        "sources": sources,
    }
