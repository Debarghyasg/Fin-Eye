"""
LLM answer generator — Week 3 stub.

Week 3 implementation plan:
  1. Build a system prompt with compliance + citation instructions
  2. Format reranked chunks as numbered context blocks:
       [1] Apple 10-K p.23: "Total net sales: $383,285 million…"
       [2] Apple 10-K p.31: "Services net sales: $85,200 million…"
  3. Call GPT-4o with structured output (JSON mode):
       {
         "answer": "...",
         "citations": [1, 2],
         "confidence": 0.94
       }
  4. Map citation indices back to chunk / document / page metadata
  5. Return QueryResponse with inline source references

Fallback: if GPT-4o is unavailable, retry with Claude 3.5 Sonnet.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.db.schemas import QueryResponse


async def generate_answer(
    query: str,
    reranked_chunks: list[dict],
    model: str = "gpt-4o",
) -> "QueryResponse":
    """
    Generate a cited answer from the reranked chunk context.

    STUB — raises NotImplementedError until Week 3.
    """
    raise NotImplementedError("LLM answer generator not implemented yet — Week 3.")
