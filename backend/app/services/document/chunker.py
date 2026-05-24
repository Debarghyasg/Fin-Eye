"""
Document chunking service — Week 2.

Two strategies, chosen per content type:

1. PROSE chunking  (fixed-size with overlap)
   ─ 800-character windows, 150-character overlap
   ─ Breaks on sentence/paragraph boundaries where possible
   ─ Applied to every page's prose text

2. TABLE chunking  (whole-cell, one chunk per table)
   ─ The entire table (headers + all rows) becomes one chunk
   ─ Never splits a table across chunks — financial tables must stay intact
   ─ table_header field stores the serialised header row for metadata filtering

3. HEADER detection
   ─ Short lines (≤ 120 chars) that look like section headings are tagged
     as ChunkType.HEADER so the re-ranker can weight them differently.

Each chunk carries full positional metadata:
  document_id, page_number, chunk_type, chunk_index,
  char_start, char_end, source_section, table_header
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Generator

from app.core.config import settings
from app.db.models import ChunkType
from app.services.document.extractor import ExtractionResult, ExtractedPage, ExtractedTable

log = logging.getLogger(__name__)

# ── Heading detection heuristic ───────────────────────────────────────────────
# Lines that are short, don't end in a full stop, and start with a capital
_HEADING_RE = re.compile(r"^[A-Z0-9][^\n.]{3,119}$")

# Section keywords common in SEC filings
_SECTION_KEYWORDS = re.compile(
    r"\b(ITEM\s+\d+|RISK FACTORS|MANAGEMENT'S DISCUSSION|FINANCIAL STATEMENTS"
    r"|NOTES TO|SELECTED FINANCIAL|SIGNATURES|EXHIBITS)\b",
    re.IGNORECASE,
)


# ── Output dataclass ──────────────────────────────────────────────────────────
@dataclass
class Chunk:
    document_id: str
    chunk_index: int              # 0-based, globally ordered across the document
    text: str
    chunk_type: ChunkType
    page_number: int | None = None
    char_start: int | None = None
    char_end: int | None = None
    source_section: str | None = None
    table_header: str | None = None   # JSON-serialised list of header strings


# ── Helpers ───────────────────────────────────────────────────────────────────
def _is_heading(line: str) -> bool:
    stripped = line.strip()
    return bool(_HEADING_RE.match(stripped)) or bool(_SECTION_KEYWORDS.search(stripped))


def _split_prose(
    text: str,
    chunk_size: int,
    overlap: int,
) -> Generator[tuple[str, int, int], None, None]:
    """
    Yield (chunk_text, char_start, char_end) tuples.

    Tries to break at the last sentence boundary (". ") within the window
    rather than mid-word.
    """
    if not text.strip():
        return

    start = 0
    length = len(text)

    while start < length:
        end = min(start + chunk_size, length)

        # Try to snap to a sentence boundary within the last 20% of the window
        if end < length:
            search_from = start + int(chunk_size * 0.8)
            boundary = text.rfind(". ", search_from, end)
            if boundary != -1:
                end = boundary + 2   # include the ". "
            else:
                # Fall back to last whitespace
                ws = text.rfind(" ", search_from, end)
                if ws != -1:
                    end = ws + 1

        chunk_text = text[start:end].strip()
        if chunk_text:
            yield chunk_text, start, end

        # Advance with overlap
        start = end - overlap if end < length else length


# ── Main chunking logic ───────────────────────────────────────────────────────
def chunk_document(
    extraction: ExtractionResult,
    chunk_size: int | None = None,
    overlap: int | None = None,
) -> list[Chunk]:
    """
    Chunk an ExtractionResult into a list of Chunk objects.

    Processing order per page:
      1. Section headings   → ChunkType.HEADER
      2. Tables             → ChunkType.TABLE  (one chunk per table)
      3. Remaining prose    → ChunkType.PROSE  (fixed-size with overlap)

    Returns chunks sorted by (page_number, chunk_index).
    """
    chunk_size = chunk_size or settings.CHUNK_SIZE_CHARS
    overlap    = overlap    or settings.CHUNK_OVERLAP_CHARS

    chunks: list[Chunk] = []
    idx = 0
    current_section: str | None = None

    for page in extraction.pages:
        # ── 1. Detect headings in prose ───────────────────────────────────────
        lines = page.text.split("\n")
        prose_lines: list[str] = []

        for line in lines:
            if _is_heading(line):
                stripped = line.strip()
                # Emit heading as its own chunk
                chunks.append(Chunk(
                    document_id=extraction.document_id,
                    chunk_index=idx,
                    text=stripped,
                    chunk_type=ChunkType.HEADER,
                    page_number=page.page_number,
                    source_section=stripped,
                ))
                idx += 1
                current_section = stripped   # track for subsequent chunks
            else:
                prose_lines.append(line)

        # ── 2. Table chunks (whole-table, never split) ────────────────────────
        for table in page.tables:
            table_text = _table_to_text(table)
            if not table_text.strip():
                continue
            chunks.append(Chunk(
                document_id=extraction.document_id,
                chunk_index=idx,
                text=table_text,
                chunk_type=ChunkType.TABLE,
                page_number=page.page_number,
                source_section=current_section,
                table_header=json.dumps(table.headers, ensure_ascii=False),
            ))
            idx += 1

        # ── 3. Prose chunks (fixed-size with overlap) ─────────────────────────
        prose_text = "\n".join(prose_lines)
        for chunk_text, char_start, char_end in _split_prose(prose_text, chunk_size, overlap):
            chunks.append(Chunk(
                document_id=extraction.document_id,
                chunk_index=idx,
                text=chunk_text,
                chunk_type=ChunkType.PROSE,
                page_number=page.page_number,
                char_start=char_start,
                char_end=char_end,
                source_section=current_section,
            ))
            idx += 1

    log.info(
        "Chunked document %r: %d chunks (%d prose, %d table, %d header) from %d pages",
        extraction.document_id,
        len(chunks),
        sum(1 for c in chunks if c.chunk_type == ChunkType.PROSE),
        sum(1 for c in chunks if c.chunk_type == ChunkType.TABLE),
        sum(1 for c in chunks if c.chunk_type == ChunkType.HEADER),
        extraction.page_count,
    )
    return chunks


# ── Table → text serialiser ───────────────────────────────────────────────────
def _table_to_text(table: ExtractedTable) -> str:
    """
    Serialise a table to a pipe-delimited text block suitable for embedding.

    Format:
        [TABLE]
        Headers: Revenue | 2023 | 2022
        Row 1: Product | $383.3B | $394.3B
        Row 2: ...
        [/TABLE]
    """
    lines = ["[TABLE]"]
    if table.headers:
        lines.append("Headers: " + " | ".join(str(h) for h in table.headers))
    for i, row in enumerate(table.rows, start=1):
        lines.append(f"Row {i}: " + " | ".join(str(c) for c in row))
    lines.append("[/TABLE]")
    return "\n".join(lines)
