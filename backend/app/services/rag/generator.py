"""
LLM answer generator — Week 3.

Uses GPT-4o with JSON mode to produce a structured response containing:
  - answer    : natural language answer with inline citation markers [1], [2]…
  - citations : list of source indices the answer draws on
  - confidence: self-reported float 0–1

System prompt design
--------------------
  The system prompt instructs GPT-4o to:
  1. Answer ONLY from the provided context — never hallucinate.
  2. Always cite sources using [N] notation.
  3. If the answer cannot be found in context, say so explicitly.
  4. Output valid JSON matching our schema.

Context formatting
------------------
  Each reranked chunk is presented as a numbered block:

    [1] Source: Apple 10-K FY2023 | p.23 | Risk Factors
    "Total net sales for fiscal 2023 were $383,285 million…"

    [2] Source: Apple 10-K FY2023 | p.31 | Financial Statements
    "Services net sales grew 9% to $85,200 million…"

Fallback
--------
  If GPT-4o is unavailable or returns an invalid JSON response,
  we retry once with gpt-4o-mini as a cheaper fallback.
"""
from __future__ import annotations

import json
import logging
import time
from typing import TYPE_CHECKING

from app.core.config import settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

# ── System prompt ─────────────────────────────────────────────────────────────
_SYSTEM_PROMPT = """You are FinSight AI, a financial document intelligence assistant for investment analysts.

RULES (follow strictly):
1. Answer ONLY using the numbered source context provided below.
2. If the answer is not in the context, respond: "I cannot find this information in the provided documents."
3. Always cite sources using [N] notation inline (e.g. "Revenue was $383B [1]").
4. Be precise with numbers — never round or estimate unless the source does.
5. For comparisons, explicitly state the periods being compared.

OUTPUT FORMAT (respond with valid JSON only, no markdown):
{
  "answer": "Your answer with inline citations like [1] and [2]",
  "citations": [1, 2],
  "confidence": 0.94
}

confidence guidelines:
- 0.90–1.00: answer is directly stated in sources
- 0.70–0.89: answer requires mild inference from sources
- 0.50–0.69: answer is partially supported
- below 0.50: use the "cannot find" response instead"""


def _build_context_block(chunks: list[dict]) -> str:
    """Format reranked chunks as numbered context blocks for the prompt."""
    lines = []
    for i, chunk in enumerate(chunks, start=1):
        doc_id = chunk.get("document_id", "unknown")
        page = chunk.get("page_number")
        section = chunk.get("source_section", "")
        text = chunk.get("text", "")

        source_line = f"[{i}] Source: doc:{doc_id[:8]}…"
        if page:
            source_line += f" | p.{page}"
        if section:
            source_line += f" | {section}"

        lines.append(source_line)
        lines.append(f'"{text[:600]}"')   # truncate to keep prompt size manageable
        lines.append("")                   # blank line between chunks

    return "\n".join(lines)


def _call_openai(query: str, context: str, model: str) -> dict:
    """
    Call the OpenAI chat completions API and parse the JSON response.
    Raises ValueError if the response is not valid JSON.
    """
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    response = client.chat.completions.create(
        model=model,
        response_format={"type": "json_object"},
        temperature=0.1,      # low temp for factual accuracy
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
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"GPT-4o returned invalid JSON: {raw[:200]}") from exc


# ── Public entry point ────────────────────────────────────────────────────────
async def generate_answer(
    query: str,
    reranked_chunks: list[dict],
    model: str | None = None,
) -> dict:
    """
    Generate a cited answer from the reranked chunk context.

    Returns a dict:
        {
            "answer":     "Revenue was $383B [1]…",
            "citations":  [1, 2],
            "confidence": 0.94,
            "model_used": "gpt-4o",
            "sources":    [  ← list of source dicts for the QueryResponse
                {
                    "chunk_id":    "...",
                    "document_id": "...",
                    "page_number": 23,
                    "excerpt":     "Total net sales…",
                    "score":       0.031,
                }
            ]
        }
    """
    import asyncio
    model = model or settings.OPENAI_CHAT_MODEL
    context = _build_context_block(reranked_chunks)

    # ── Call GPT-4o (with gpt-4o-mini fallback) ───────────────────────────────
    try:
        result = await asyncio.to_thread(_call_openai, query, context, model)
    except Exception as exc:
        log.warning("Primary model %r failed (%s) — retrying with gpt-4o-mini", model, exc)
        try:
            result = await asyncio.to_thread(_call_openai, query, context, "gpt-4o-mini")
            model = "gpt-4o-mini"
        except Exception as exc2:
            log.error("Both GPT models failed: %s", exc2)
            result = {
                "answer": "The AI service is temporarily unavailable. Please try again.",
                "citations": [],
                "confidence": 0.0,
            }

    answer = result.get("answer", "")
    citations = result.get("citations", [])
    confidence = float(result.get("confidence", 0.0))

    # ── Build source references (cited chunks only) ───────────────────────────
    sources = []
    for citation_idx in citations:
        array_idx = citation_idx - 1     # citations are 1-based
        if 0 <= array_idx < len(reranked_chunks):
            chunk = reranked_chunks[array_idx]
            sources.append({
                "chunk_id":    chunk.get("chunk_id", ""),
                "document_id": chunk.get("document_id", ""),
                "page_number": chunk.get("page_number"),
                "excerpt":     chunk.get("text", "")[:300],
                "score":       chunk.get("rrf_score", 0.0),
            })

    log.info(
        "Generation complete: model=%s confidence=%.2f sources=%d answer_len=%d",
        model, confidence, len(sources), len(answer),
    )

    return {
        "answer":     answer,
        "citations":  citations,
        "confidence": confidence,
        "model_used": model,
        "sources":    sources,
    }
