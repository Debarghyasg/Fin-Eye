"""
Document text extraction service.

Strategy
--------
  PDF   → PyMuPDF (fitz) for prose text per page
          pdfplumber for structured table extraction
          pytesseract OCR fallback for image-based / presentation pages
            (triggered when fitz extracts < MIN_TEXT_CHARS on a page)
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
            "page_number": 1,
            "text": "full prose text...",
            "tables": [...]
        }
    ],
    "full_text": "concatenated prose from all pages..."
}
"""
from __future__ import annotations

import io
import json
import logging
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)
# Windows: point pytesseract at the Tesseract binary explicitly
import os as _os
_TESSERACT_CMD = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# Pages with fewer than this many characters after fitz extraction
# are considered image-based and will be passed through OCR.
_MIN_TEXT_CHARS = 50

# Windows paths — update these if you installed to a different location.
_TESSERACT_CMD = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
_POPPLER_PATH  = r"C:\poppler\Library\bin"


# ── Output dataclasses ────────────────────────────────────────────────────────
@dataclass
class ExtractedTable:
    table_index: int
    headers: list[str]
    rows: list[list[str]]
    raw_text: str


@dataclass
class ExtractedPage:
    page_number: int
    text: str
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


# ── OCR helpers ───────────────────────────────────────────────────────────────
def _ocr_available() -> bool:
    try:
        import pytesseract
        import pdf2image
        # Hardcode path for Windows
        pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        pytesseract.get_tesseract_version()  # raises if not found
        return True
    except Exception:
        return False


def _ocr_page_bytes(page_image_bytes: bytes) -> str:
    import pytesseract
    from PIL import Image
    pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    image = Image.open(io.BytesIO(page_image_bytes))
    text = pytesseract.image_to_string(image, config="--psm 6")
    return text.strip()


def _ocr_pdf_pages(file_bytes: bytes, page_numbers: list[int]) -> dict[int, str]:
    """
    Render the given pages to images with poppler and OCR them with Tesseract.
    Returns {page_number: ocr_text}. Falls back to empty string on any error.
    """
    try:
        from pdf2image import convert_from_bytes
    except ImportError:
        log.warning("pdf2image not installed — OCR fallback unavailable")
        return {}
    # ... rest of function unchanged

    results: dict[int, str] = {}
    for page_num in page_numbers:
        try:
            images = convert_from_bytes(
                file_bytes,
                first_page=page_num,
                last_page=page_num,
                dpi=200,
                poppler_path=_POPPLER_PATH,
            )
            if not images:
                results[page_num] = ""
                continue

            buf = io.BytesIO()
            images[0].save(buf, format="PNG")
            ocr_text = _ocr_page_bytes(buf.getvalue())
            results[page_num] = ocr_text
            log.debug("OCR page %d: %d chars", page_num, len(ocr_text))
        except Exception as exc:
            log.warning("OCR failed on page %d: %s", page_num, exc)
            results[page_num] = ""

    return results


# ── PDF extraction ────────────────────────────────────────────────────────────
def _extract_pdf(
    file_bytes: bytes,
    document_id: str,
    filename: str,
) -> ExtractionResult:
    """
    Extract text and tables from a PDF.

    1. fitz (PyMuPDF)  — fast prose extraction for digital PDFs.
       Also tries "blocks" mode for complex slide-style layouts.
    2. pdfplumber      — accurate table detection for financial statements.
    3. pytesseract     — OCR fallback for pages where fitz yields < 50 chars
                         (image-based PDFs, scanned docs, slide presentations).
    """
    try:
        import fitz
    except ImportError as e:
        raise RuntimeError("PyMuPDF (fitz) is not installed. Run: pip install PyMuPDF") from e

    try:
        import pdfplumber
    except ImportError as e:
        raise RuntimeError("pdfplumber is not installed. Run: pip install pdfplumber") from e

    pages: list[ExtractedPage] = []

    # ── Step 1: fitz prose extraction ─────────────────────────────────────────
    fitz_doc = fitz.open(stream=file_bytes, filetype="pdf")
    page_count = len(fitz_doc)
    log.info("Extracting PDF %r — %d pages", filename, page_count)

    fitz_pages: dict[int, str] = {}
    low_text_pages: list[int] = []

    for page_num in range(page_count):
        page = fitz_doc[page_num]

        # Standard plain-text mode
        text = page.get_text("text").strip()

        # Blocks mode often recovers text from complex slide layouts
        if len(text) < _MIN_TEXT_CHARS:
            try:
                blocks = page.get_text("blocks")
                block_text = "\n".join(
                    b[4].strip() for b in blocks
                    if isinstance(b[4], str) and b[4].strip()
                )
                if len(block_text) > len(text):
                    text = block_text
            except Exception:
                pass

        fitz_pages[page_num + 1] = text
        if len(text) < _MIN_TEXT_CHARS:
            low_text_pages.append(page_num + 1)

    fitz_doc.close()

    # ── Step 2: OCR fallback for image-heavy pages ────────────────────────────
    ocr_texts: dict[int, str] = {}
    if low_text_pages:
        if _ocr_available():
            log.info(
                "OCR fallback: %d pages with < %d chars in %r — running Tesseract",
                len(low_text_pages), _MIN_TEXT_CHARS, filename,
            )
            ocr_texts = _ocr_pdf_pages(file_bytes, low_text_pages)
        else:
            log.warning(
                "%d pages in %r had < %d chars but OCR is unavailable. "
                "Install Tesseract to C:\\Program Files\\Tesseract-OCR\\ "
                "and poppler to C:\\poppler\\Library\\bin\\",
                len(low_text_pages), filename, _MIN_TEXT_CHARS,
            )

    # Prefer OCR text when fitz was sparse
    for page_num in low_text_pages:
        ocr = ocr_texts.get(page_num, "")
        if len(ocr) > len(fitz_pages.get(page_num, "")):
            fitz_pages[page_num] = ocr
            log.debug("Page %d: used OCR text (%d chars)", page_num, len(ocr))

    # ── Step 3: pdfplumber table extraction ───────────────────────────────────
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
                cleaned = [
                    [cell.strip() if cell else "" for cell in row]
                    for row in raw_table
                ]
                headers   = cleaned[0] if cleaned else []
                data_rows = cleaned[1:] if len(cleaned) > 1 else []
                raw_text  = "\n".join(" | ".join(row) for row in cleaned)
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

    # ── Step 4: assemble per-page results ─────────────────────────────────────
    for page_num in range(1, page_count + 1):
        pages.append(
            ExtractedPage(
                page_number=page_num,
                text=fitz_pages.get(page_num, ""),
                tables=plumber_tables.get(page_num, []),
            )
        )

    total_tables   = sum(len(p.tables) for p in pages)
    ocr_rescued    = len([
        p for p in pages
        if p.page_number in low_text_pages and len(p.text) >= _MIN_TEXT_CHARS
    ])
    log.info(
        "Extraction complete: %d pages, %d tables, %d pages rescued by OCR in %r",
        page_count, total_tables, ocr_rescued, filename,
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

    if mime_type == (
        "application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document"
    ):
        raise NotImplementedError(
            "DOCX extraction not yet implemented. "
            "Add python-docx and implement _extract_docx()."
        )

    raise ValueError(f"Unsupported MIME type for extraction: {mime_type!r}")