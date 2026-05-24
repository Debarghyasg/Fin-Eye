"""
Document text extraction service.

Strategy
--------
  PDF   → PyMuPDF (fitz) for prose text per page
          pdfplumber for structured table extraction
  DOCX  → python-docx paragraph + table extraction (Week 2 extension)
  TXT   → direct read, no extraction needed

Output schema written to S3 as extracted/content.json
------------------------------------------------------
{
    "document_id": "...",
    "original_filename": "...",
    "mime_type": "...",
    "page_count": 42,
    "pages": [
        {
            "page_number": 1,          # 1-based
            "text": "full prose text…",
            "tables": [
                {
                    "table_index": 0,
                    "headers": ["Revenue", "2023", "2022"],
                    "rows": [["Product", "383.3B", "394.3B"], …],
                    "raw_text": "Revenue | 2023 | 2022\n…"
                }
            ]
        }
    ],
    "full_text": "concatenated prose from all pages…"
}
"""
from __future__ import annotations

import io
import json
import logging
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)


# ── Output dataclasses ────────────────────────────────────────────────────────
@dataclass
class ExtractedTable:
    table_index: int
    headers: list[str]
    rows: list[list[str]]
    raw_text: str


@dataclass
class ExtractedPage:
    page_number: int          # 1-based
    text: str                 # prose text from this page
    tables: list[ExtractedTable] = field(default_factory=list)


@dataclass
class ExtractionResult:
    document_id: str
    original_filename: str
    mime_type: str
    page_count: int
    pages: list[ExtractedPage]

    @property
    def full_text(self) -> str:
        """Concatenated prose from all pages, separated by newlines."""
        return "\n\n".join(p.text for p in self.pages if p.text.strip())

    def to_dict(self) -> dict[str, Any]:
        return {
            "document_id": self.document_id,
            "original_filename": self.original_filename,
            "mime_type": self.mime_type,
            "page_count": self.page_count,
            "full_text": self.full_text,
            "pages": [
                {
                    "page_number": p.page_number,
                    "text": p.text,
                    "tables": [
                        {
                            "table_index": t.table_index,
                            "headers": t.headers,
                            "rows": t.rows,
                            "raw_text": t.raw_text,
                        }
                        for t in p.tables
                    ],
                }
                for p in self.pages
            ],
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


# ── PDF extraction ────────────────────────────────────────────────────────────
def _extract_pdf(
    file_bytes: bytes,
    document_id: str,
    filename: str,
) -> ExtractionResult:
    """
    Extract text and tables from a PDF.

    - fitz (PyMuPDF) for per-page prose text  → fast, handles scanned text via
      embedded fonts; does NOT do OCR (add OCR in Week 4 if needed).
    - pdfplumber for table detection          → more accurate than fitz for
      financial statement tables.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError as e:
        raise RuntimeError("PyMuPDF (fitz) is not installed. Run: pip install PyMuPDF") from e

    try:
        import pdfplumber
    except ImportError as e:
        raise RuntimeError("pdfplumber is not installed. Run: pip install pdfplumber") from e

    pages: list[ExtractedPage] = []

    # ── Open with fitz for prose text ─────────────────────────────────────────
    fitz_doc = fitz.open(stream=file_bytes, filetype="pdf")
    page_count = len(fitz_doc)
    log.info("Extracting PDF %r — %d pages", filename, page_count)

    # Pre-extract all prose text with fitz
    fitz_pages: dict[int, str] = {}
    for page_num in range(page_count):
        page = fitz_doc[page_num]
        text = page.get_text("text")  # plain text, preserves layout
        fitz_pages[page_num + 1] = text.strip()
    fitz_doc.close()

    # ── Open with pdfplumber for tables ───────────────────────────────────────
    plumber_tables: dict[int, list[ExtractedTable]] = {}
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page_num, plumber_page in enumerate(pdf.pages, start=1):
            tables_on_page: list[ExtractedTable] = []
            try:
                raw_tables = plumber_page.extract_tables()
            except Exception as exc:
                log.warning("pdfplumber table error on page %d: %s", page_num, exc)
                raw_tables = []

            for t_idx, raw_table in enumerate(raw_tables):
                if not raw_table:
                    continue
                # First non-empty row → headers; remainder → data rows
                cleaned_table = [
                    [cell.strip() if cell else "" for cell in row]
                    for row in raw_table
                ]
                headers = cleaned_table[0] if cleaned_table else []
                data_rows = cleaned_table[1:] if len(cleaned_table) > 1 else []
                raw_text = "\n".join(" | ".join(row) for row in cleaned_table)

                tables_on_page.append(
                    ExtractedTable(
                        table_index=t_idx,
                        headers=headers,
                        rows=data_rows,
                        raw_text=raw_text,
                    )
                )
            if tables_on_page:
                plumber_tables[page_num] = tables_on_page

    # ── Assemble per-page results ─────────────────────────────────────────────
    for page_num in range(1, page_count + 1):
        pages.append(
            ExtractedPage(
                page_number=page_num,
                text=fitz_pages.get(page_num, ""),
                tables=plumber_tables.get(page_num, []),
            )
        )

    total_tables = sum(len(p.tables) for p in pages)
    log.info(
        "Extraction complete: %d pages, %d tables found in %r",
        page_count, total_tables, filename,
    )

    return ExtractionResult(
        document_id=document_id,
        original_filename=filename,
        mime_type="application/pdf",
        page_count=page_count,
        pages=pages,
    )


# ── Plain-text extraction ─────────────────────────────────────────────────────
def _extract_txt(
    file_bytes: bytes,
    document_id: str,
    filename: str,
) -> ExtractionResult:
    """Treat the whole file as a single 'page' of prose."""
    text = file_bytes.decode("utf-8", errors="replace").strip()
    return ExtractionResult(
        document_id=document_id,
        original_filename=filename,
        mime_type="text/plain",
        page_count=1,
        pages=[ExtractedPage(page_number=1, text=text, tables=[])],
    )


# ── Public entry point ────────────────────────────────────────────────────────
def extract_document(
    file_bytes: bytes,
    document_id: str,
    filename: str,
    mime_type: str,
) -> ExtractionResult:
    """
    Route to the correct extractor based on MIME type.

    Raises ValueError for unsupported types.
    Raises RuntimeError if a required library is missing.
    """
    log.info(
        "Starting extraction: document_id=%s filename=%r mime_type=%s size=%d bytes",
        document_id, filename, mime_type, len(file_bytes),
    )

    if mime_type == "application/pdf":
        return _extract_pdf(file_bytes, document_id, filename)

    if mime_type == "text/plain":
        return _extract_txt(file_bytes, document_id, filename)

    # DOCX support placeholder — implement in Week 2 extension
    if mime_type == (
        "application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document"
    ):
        raise NotImplementedError(
            "DOCX extraction not yet implemented. "
            "Add python-docx and implement _extract_docx()."
        )

    raise ValueError(f"Unsupported MIME type for extraction: {mime_type!r}")
