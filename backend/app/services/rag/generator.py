"""
LLM answer generator — FREE stack (Groq + Llama 3.1 70B).

Groq free tier
--------------
  - 14,400 requests/day
  - 6,000 tokens/minute
  - Model: llama-3.1-70b-versatile  (best quality)
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


def _build_context(chunks: list[dict]) -> str:
    """Build context with document names and enhanced formatting for citations."""
    lines = []
    for i, chunk in enumerate(chunks, start=1):
        page = chunk.get("page_number")
        section = chunk.get("source_section", "")
        text = chunk.get("text", "")
        doc_id = chunk.get("document_id", "")
        
        # Use document_id as document name for now
        # In a future enhancement, this could lookup the actual filename from the database
        document_name = f"Document-{doc_id[:8]}"

        header = f"[{i}] Document: {document_name}"
        if page:
            header += f" | Page: {page}"
        if section:
            header += f" | Section: {section}"

        lines.append(header)
        lines.append(f'Content: "{text[:800]}"')  # Increased from 600 to 800 for better context
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
            "model_used": "llama-3.1-70b-versatile",
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
    citations = result.get("citations", [])
    confidence = float(result.get("confidence", 0.0))

    # Handle both old format (list of ints) and new format (list of dicts)
    processed_citations = []
    sources = []
    
    if citations:
        for citation in citations:
            if isinstance(citation, dict):
                # New structured format
                chunk_idx = int(citation.get("chunk_id", "0")) - 1  # Convert 1-based to 0-based
                if 0 <= chunk_idx < len(reranked_chunks):
                    chunk = reranked_chunks[chunk_idx]
                    processed_citations.append(citation)
                    sources.append({
                        "chunk_id": chunk.get("chunk_id", ""),
                        "document_id": chunk.get("document_id", ""),
                        "page_number": chunk.get("page_number"),
                        "excerpt": citation.get("excerpt", chunk.get("text", "")[:300]),
                        "score": chunk.get("rerank_score", chunk.get("rrf_score", 0.0)),
                    })
            else:
                # Legacy format (integer indices) - convert to new format
                citation_idx = int(citation)
                array_idx = citation_idx - 1  # 1-based → 0-based
                if 0 <= array_idx < len(reranked_chunks):
                    chunk = reranked_chunks[array_idx]
                    doc_id = chunk.get("document_id", "")
                    
                    processed_citations.append({
                        "chunk_id": str(citation_idx),
                        "page_number": chunk.get("page_number"),
                        "excerpt": chunk.get("text", "")[:200],
                        "document_name": f"Document-{doc_id[:8]}"
                    })
                    
                    sources.append({
                        "chunk_id": chunk.get("chunk_id", ""),
                        "document_id": chunk.get("document_id", ""),
                        "page_number": chunk.get("page_number"),
                        "excerpt": chunk.get("text", "")[:300],
                        "score": chunk.get("rerank_score", chunk.get("rrf_score", 0.0)),
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
