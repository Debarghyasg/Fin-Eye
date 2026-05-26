"""
Unit tests for the chunker service — no DB, no AWS, pure logic.

Run with:
    pytest tests/test_chunker.py -v
"""
import pytest

from app.db.models import ChunkType
from app.services.document.chunker import Chunk, chunk_document
from app.services.document.extractor import (
    ExtractionResult,
    ExtractedPage,
    ExtractedTable,
)


def _make_extraction(pages: list[ExtractedPage]) -> ExtractionResult:
    return ExtractionResult(
        document_id="test-doc-id",
        original_filename="test.pdf",
        mime_type="application/pdf",
        page_count=len(pages),
        pages=pages,
    )


def test_prose_chunks_created():
    """800-char prose should produce at least one PROSE chunk."""
    page = ExtractedPage(page_number=1, text="A" * 900, tables=[])
    result = chunk_document(_make_extraction([page]), chunk_size=800, overlap=150)
    prose = [c for c in result if c.chunk_type == ChunkType.PROSE]
    assert len(prose) >= 1


def test_prose_overlap():
    """With 800/150 settings, two chunks should share overlapping text."""
    text = "word " * 300   # 1500 chars
    page = ExtractedPage(page_number=1, text=text, tables=[])
    result = chunk_document(_make_extraction([page]), chunk_size=800, overlap=150)
    prose = [c for c in result if c.chunk_type == ChunkType.PROSE]
    assert len(prose) >= 2
    # Second chunk should start before char 800 - 150 = 650 into the first chunk
    assert prose[1].char_start is not None
    assert prose[1].char_start < 800


def test_table_chunk_not_split():
    """A table should always produce exactly one TABLE chunk regardless of size."""
    big_table = ExtractedTable(
        table_index=0,
        headers=["Col A", "Col B", "Col C"],
        rows=[["val"] * 3] * 50,   # 50 rows → would exceed 800 chars if split
        raw_text="",
    )
    page = ExtractedPage(page_number=1, text="", tables=[big_table])
    result = chunk_document(_make_extraction([page]))
    table_chunks = [c for c in result if c.chunk_type == ChunkType.TABLE]
    assert len(table_chunks) == 1


def test_table_header_metadata():
    """TABLE chunk should have table_header populated as a JSON string."""
    import json
    table = ExtractedTable(
        table_index=0,
        headers=["Revenue", "2023", "2022"],
        rows=[["Products", "$383B", "$394B"]],
        raw_text="",
    )
    page = ExtractedPage(page_number=1, text="", tables=[table])
    result = chunk_document(_make_extraction([page]))
    table_chunk = next(c for c in result if c.chunk_type == ChunkType.TABLE)
    assert table_chunk.table_header is not None
    headers = json.loads(table_chunk.table_header)
    assert headers == ["Revenue", "2023", "2022"]


def test_heading_detection():
    """Short all-caps lines should be tagged as HEADER chunks."""
    text = "RISK FACTORS\nThis section describes material risks to the business."
    page = ExtractedPage(page_number=1, text=text, tables=[])
    result = chunk_document(_make_extraction([page]))
    headers = [c for c in result if c.chunk_type == ChunkType.HEADER]
    assert len(headers) >= 1
    assert "RISK FACTORS" in headers[0].text


def test_chunk_indices_sequential():
    """All chunk indices must be 0-based and strictly sequential."""
    text = "sentence. " * 200
    page = ExtractedPage(page_number=1, text=text, tables=[])
    result = chunk_document(_make_extraction([page]))
    indices = [c.chunk_index for c in result]
    assert indices == list(range(len(result)))


def test_page_number_propagated():
    """Every chunk should carry the correct page_number."""
    pages = [
        ExtractedPage(page_number=1, text="Page one content. " * 60, tables=[]),
        ExtractedPage(page_number=2, text="Page two content. " * 60, tables=[]),
    ]
    result = chunk_document(_make_extraction(pages))
    p1 = [c for c in result if c.page_number == 1]
    p2 = [c for c in result if c.page_number == 2]
    assert len(p1) > 0
    assert len(p2) > 0


def test_empty_document_produces_no_chunks():
    """A document with no text and no tables should yield zero chunks."""
    page = ExtractedPage(page_number=1, text="", tables=[])
    result = chunk_document(_make_extraction([page]))
    assert result == []



# ─────────────────────────────────────────────────────────────────────────────
# Week 11 — extended chunker tests covering different document types
# ─────────────────────────────────────────────────────────────────────────────


def test_txt_extraction_then_chunk():
    """TXT files extract as a single page; chunker should still emit prose chunks."""
    from app.services.document.extractor import extract_document

    body = ("This is a plain text financial note. " * 60).encode("utf-8")
    extraction = extract_document(
        body, document_id="doc-txt", filename="note.txt", mime_type="text/plain"
    )
    assert extraction.page_count == 1
    assert extraction.pages[0].text.startswith("This is a plain text financial")

    chunks = chunk_document(extraction, chunk_size=400, overlap=80)
    assert chunks, "TXT extraction should still produce chunks"
    assert all(c.chunk_type in (ChunkType.PROSE, ChunkType.HEADER) for c in chunks)
    assert chunks[0].document_id == "doc-txt"


def test_unsupported_mime_raises_value_error():
    """The extractor must reject MIME types it does not handle."""
    from app.services.document.extractor import extract_document

    with pytest.raises(ValueError):
        extract_document(b"<html></html>", "doc-html", "page.html", "text/html")


def test_docx_extraction_not_yet_implemented():
    """DOCX is intentionally NotImplementedError until we ship python-docx support."""
    from app.services.document.extractor import extract_document

    with pytest.raises(NotImplementedError):
        extract_document(
            b"PK\x03\x04",  # ZIP magic — DOCX is a zip archive
            "doc-docx",
            "report.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )


def test_sec_keyword_heading_is_detected():
    """SEC section keywords should be picked up even when not all-caps."""
    text = (
        "Item 1A. Risk Factors\n"
        "We face material risks related to supply chain concentration."
    )
    page = ExtractedPage(page_number=1, text=text, tables=[])
    chunks = chunk_document(_make_extraction([page]))
    headers = [c for c in chunks if c.chunk_type == ChunkType.HEADER]
    assert any("Item 1A" in c.text or "Risk Factors" in c.text for c in headers)


def test_heading_propagated_as_source_section():
    """After a HEADER is emitted, subsequent prose chunks inherit its text."""
    text = (
        "MANAGEMENT DISCUSSION\n"
        + ("Revenue of $383B was driven by Services growth. " * 20)
    )
    page = ExtractedPage(page_number=1, text=text, tables=[])
    chunks = chunk_document(_make_extraction([page]), chunk_size=400, overlap=50)

    prose = [c for c in chunks if c.chunk_type == ChunkType.PROSE]
    assert prose, "expected at least one prose chunk"
    assert prose[0].source_section is not None
    assert "MANAGEMENT" in prose[0].source_section.upper()


def test_table_serialised_with_headers_and_rows():
    """The pipe-delimited TABLE block must include both headers and rows."""
    table = ExtractedTable(
        table_index=0,
        headers=["Metric", "FY23", "FY22"],
        rows=[
            ["Revenue",   "$383.3B", "$394.3B"],
            ["Net Income", "$97.0B", "$99.8B"],
        ],
        raw_text="",
    )
    page = ExtractedPage(page_number=2, text="", tables=[table])
    chunks = chunk_document(_make_extraction([page]))
    table_chunk = next(c for c in chunks if c.chunk_type == ChunkType.TABLE)

    assert "[TABLE]" in table_chunk.text
    assert "[/TABLE]" in table_chunk.text
    assert "Headers: Metric | FY23 | FY22" in table_chunk.text
    assert "Revenue | $383.3B | $394.3B" in table_chunk.text
    assert "Net Income | $97.0B | $99.8B" in table_chunk.text
    assert table_chunk.page_number == 2


def test_mixed_page_with_heading_table_and_prose_emits_three_kinds():
    """A single page mixing a heading, a table, and prose must emit all three types."""
    table = ExtractedTable(
        table_index=0,
        headers=["Q", "Sales"],
        rows=[["Q1", "100"], ["Q2", "120"]],
        raw_text="",
    )
    text = (
        "RISK FACTORS\n"
        + ("Macro headwinds may pressure margins going forward. " * 25)
    )
    page = ExtractedPage(page_number=3, text=text, tables=[table])

    chunks = chunk_document(_make_extraction([page]), chunk_size=500, overlap=80)
    types = {c.chunk_type for c in chunks}
    assert ChunkType.HEADER in types
    assert ChunkType.TABLE in types
    assert ChunkType.PROSE in types

    # Each chunk knows which page it came from
    assert all(c.page_number == 3 for c in chunks)


def test_empty_table_skipped():
    """Tables with no headers and no rows should not produce a TABLE chunk."""
    empty_table = ExtractedTable(table_index=0, headers=[], rows=[], raw_text="")
    page = ExtractedPage(page_number=1, text="Some prose text here." * 10, tables=[empty_table])
    chunks = chunk_document(_make_extraction([page]))
    assert all(c.chunk_type != ChunkType.TABLE for c in chunks)


def test_custom_chunk_size_and_overlap_override_settings():
    """Explicit chunk_size/overlap arguments must override the defaults."""
    text = "x " * 1000   # 2000 chars
    page = ExtractedPage(page_number=1, text=text, tables=[])

    # Tiny chunks → many pieces
    small = chunk_document(_make_extraction([page]), chunk_size=200, overlap=50)
    # Large chunks → few pieces
    large = chunk_document(_make_extraction([page]), chunk_size=2000, overlap=200)

    small_prose = [c for c in small if c.chunk_type == ChunkType.PROSE]
    large_prose = [c for c in large if c.chunk_type == ChunkType.PROSE]
    assert len(small_prose) > len(large_prose)


def test_multi_page_document_orders_chunks_by_page():
    """Chunks across pages should appear in page order with strictly increasing index."""
    pages = [
        ExtractedPage(page_number=1, text="alpha alpha alpha. " * 50, tables=[]),
        ExtractedPage(page_number=2, text="beta beta beta. " * 50, tables=[]),
        ExtractedPage(page_number=3, text="gamma gamma gamma. " * 50, tables=[]),
    ]
    chunks = chunk_document(_make_extraction(pages))

    page_seq = [c.page_number for c in chunks]
    # Within each page block, page_number is constant; across the doc it never decreases.
    assert page_seq == sorted(page_seq)
    # And the global index is strictly increasing
    indices = [c.chunk_index for c in chunks]
    assert indices == sorted(indices)


def test_chunks_carry_document_id_consistently():
    """Every emitted chunk must reference the original document_id."""
    page = ExtractedPage(page_number=1, text="hello world. " * 30, tables=[])
    extraction = _make_extraction([page])
    chunks = chunk_document(extraction)
    assert chunks
    assert all(c.document_id == extraction.document_id for c in chunks)
