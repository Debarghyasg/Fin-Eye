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
