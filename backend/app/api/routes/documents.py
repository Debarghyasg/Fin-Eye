"""
Document routes — /api/v1/documents

The upload endpoint is deliberately non-blocking:
  1. Validate file (type + size)
  2. Write document row to Postgres (status = uploading)
  3. Upload raw bytes to S3
  4. Run PII scan (AWS Comprehend / regex fallback)
  5. Update document row (status = uploaded, pii result)
  6. Publish SQS event → async pipeline picks it up
  7. Return DocumentUploadResponse immediately (document_id + status)

The heavy lifting (extraction → chunking → embedding) happens asynchronously
in a worker process consuming the SQS queue, NOT in this request thread.

Endpoints
---------
POST   /documents/upload           → upload a new document
GET    /documents                  → list documents in a workspace
GET    /documents/{document_id}    → get document detail + status
GET    /documents/{document_id}/chunks → list extracted chunks
PATCH  /documents/{document_id}    → update metadata (ticker, doc_type, etc.)
DELETE /documents/{document_id}    → delete document + S3 objects + chunks
GET    /documents/{document_id}/status → lightweight polling endpoint
"""
from __future__ import annotations

import asyncio
import logging
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.db.models import Chunk, Document, DocumentStatus, DocumentType, User, Workspace
from app.db.schemas import (
    ChunkOut,
    DocumentOut,
    DocumentStatusResponse,
    DocumentUpdate,
    DocumentUploadResponse,
    PaginatedList,
)
from app.services.storage import storage
from app.services.compliance.pii_scanner import scan_for_pii
from app.services.audit import record_audit_event

log = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["documents"])

# ── Allowed MIME types (mirrors settings for fast local rejection) ─────────────
_ALLOWED_TYPES = set(settings.ALLOWED_MIME_TYPES)
_MAX_BYTES = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024


# ── Helpers ───────────────────────────────────────────────────────────────────
async def _get_document_or_404(
    document_id: str,
    current_user: User,
    db: AsyncSession,
) -> Document:
    """Fetch a document, verify it belongs to the requesting user's workspace."""
    result = await db.execute(
        select(Document)
        .join(Workspace, Document.workspace_id == Workspace.id)
        .where(
            Document.id == document_id,
            Workspace.owner_id == current_user.id,
        )
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return doc


async def _process_document_pipeline(document_id: str, s3_key: str, mime_type: str) -> None:
    """
    Background task: run extraction → chunking → (Week 3: embedding).

    In local dev this runs in-process via FastAPI BackgroundTasks.
    In production this is triggered by the SQS consumer Lambda / worker.
    """
    from app.db.session import AsyncSessionLocal
    from app.services.document.extractor import extract_document
    from app.services.document.chunker import chunk_document
    from app.db.models import Chunk as ChunkModel

    async with AsyncSessionLocal() as db:
        try:
            # ── 1. Mark as extracting ──────────────────────────────────────────
            result = await db.execute(select(Document).where(Document.id == document_id))
            doc = result.scalar_one()
            doc.status = DocumentStatus.EXTRACTING
            await db.commit()

            # ── 2. Download from storage ──────────────────────────────────────
            file_bytes = await asyncio.to_thread(storage.download, s3_key)

            # ── 3. Extract text + tables ──────────────────────────────────────
            extraction = await asyncio.to_thread(
                extract_document, file_bytes, document_id, doc.original_filename, mime_type
            )
            doc.page_count = extraction.page_count
            doc.status = DocumentStatus.EXTRACTED

            # Write extracted JSON back to storage
            extracted_key = storage.extracted_key(document_id)
            await asyncio.to_thread(storage.upload_json, extraction.to_dict(), extracted_key)
            doc.s3_key_extracted = extracted_key
            await db.commit()

            # ── 3.5. Post-extraction PII scan ─────────────────────────────────
            # This is the authoritative scan — it runs against real extracted
            # text rather than the raw bytes seen at upload time. Result is
            # stored on the document row for the audit trail; high-risk PII
            # does NOT auto-block downstream processing here, but compliance
            # officers can filter for `pii_scan_passed=false` to review.
            try:
                pii_result = await asyncio.to_thread(scan_for_pii, extraction.full_text)
                doc.pii_scan_passed = pii_result.passed
                if pii_result.entities:
                    import json as _json
                    doc.pii_entities_found = _json.dumps({
                        "scanner": pii_result.scanner,
                        "stage": "post_extraction",
                        "flagged_types": pii_result.flagged_types,
                        "entities": [
                            {"type": e.get("Type"), "score": e.get("Score")}
                            for e in pii_result.entities[:50]
                        ],
                    })
                else:
                    doc.pii_entities_found = None
                await db.commit()
                log.info(
                    "PII scan complete: document_id=%s passed=%s scanner=%s flagged=%s",
                    document_id, pii_result.passed, pii_result.scanner,
                    pii_result.flagged_types,
                )
            except Exception as pii_exc:
                # PII scan failure must NOT block the pipeline.
                log.warning(
                    "PII scan failed for document_id=%s: %s — continuing pipeline",
                    document_id, pii_exc,
                )

            # ── 4. Chunk ──────────────────────────────────────────────────────
            doc.status = DocumentStatus.CHUNKING
            await db.commit()

            chunks = await asyncio.to_thread(chunk_document, extraction)

            chunk_models = [
                ChunkModel(
                    document_id=document_id,
                    text=c.text,
                    chunk_type=c.chunk_type,
                    chunk_index=c.chunk_index,
                    page_number=c.page_number,
                    char_start=c.char_start,
                    char_end=c.char_end,
                    source_section=c.source_section,
                    table_header=c.table_header,
                )
                for c in chunks
            ]
            db.add_all(chunk_models)
            doc.status = DocumentStatus.CHUNKED
            await db.commit()

            log.info(
                "Chunking complete: document_id=%s chunks=%d",
                document_id, len(chunks),
            )

            # ── 5. Embed + index — Qdrant native hybrid (PR 2) ─────────────
            # Replaces the ChromaDB-only path. fastembed BM25 sparse vectors
            # live alongside the dense MiniLM vectors in the same collection,
            # so the separate Redis-cached BM25 rebuild is gone.
            from app.services.document.embedder import embed_and_index_chunks

            try:
                vectors_upserted = await embed_and_index_chunks(
                    chunks=chunks,
                    document_id=document_id,
                    workspace_id=doc.workspace_id,
                    ticker=doc.ticker,
                    fiscal_period=doc.fiscal_period,
                    db=db,
                )
                log.info(
                    "Embedding complete: document_id=%s vectors=%d",
                    document_id, vectors_upserted,
                )
            except Exception as embed_exc:
                # Embedding failure should NOT fail the whole pipeline.
                # Document stays at CHUNKED — analyst can still browse chunks.
                # Re-indexing can be triggered manually later.
                log.error(
                    "Embedding/indexing failed for document_id=%s: %s — "
                    "document stays at CHUNKED status",
                    document_id, embed_exc,
                )

            log.info(
                "Pipeline complete: document_id=%s chunks=%d",
                document_id, len(chunks),
            )

        except Exception as exc:
            log.exception("Pipeline failed for document_id=%s: %s", document_id, exc)
            async with AsyncSessionLocal() as err_db:
                err_result = await err_db.execute(
                    select(Document).where(Document.id == document_id)
                )
                err_doc = err_result.scalar_one_or_none()
                if err_doc:
                    err_doc.status = DocumentStatus.FAILED
                    err_doc.error_message = str(exc)
                    await err_db.commit()


# ── POST /documents/upload ────────────────────────────────────────────────────
@router.post(
    "/upload",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a financial document",
)
async def upload_document(
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = File(...),
    workspace_id: str = Form(...),
    doc_type: str = Form(default="other"),
    company_name: str | None = Form(default=None),
    ticker: str | None = Form(default=None),
    fiscal_period: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentUploadResponse:
    """
    Accept a PDF/DOCX/TXT upload, write to S3, scan for PII, queue for processing.
    Returns a document_id immediately — do not wait for extraction to complete.
    """
    # ── Validate workspace ownership ──────────────────────────────────────────
    ws_result = await db.execute(
        select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.owner_id == current_user.id,
        )
    )
    if not ws_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found.")

    # ── Validate MIME type ────────────────────────────────────────────────────
    mime_type = file.content_type or "application/octet-stream"
    if mime_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"File type {mime_type!r} is not supported. Allowed: {sorted(_ALLOWED_TYPES)}",
        )

    # ── Read + validate size ──────────────────────────────────────────────────
    file_bytes = await file.read()
    if len(file_bytes) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum size of {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    # ── Validate doc_type enum ────────────────────────────────────────────────
    try:
        doc_type_enum = DocumentType(doc_type)
    except ValueError:
        doc_type_enum = DocumentType.OTHER

    # ── Create document row (status = uploading) ──────────────────────────────
    doc = Document(
        workspace_id=workspace_id,
        uploaded_by_id=current_user.id,
        original_filename=file.filename or "upload",
        mime_type=mime_type,
        file_size_bytes=len(file_bytes),
        doc_type=doc_type_enum,
        company_name=company_name,
        ticker=ticker.upper() if ticker else None,
        fiscal_period=fiscal_period,
        status=DocumentStatus.UPLOADING,
    )
    db.add(doc)
    await db.flush()   # get doc.id before S3 upload
    document_id = doc.id

    # ── Upload to S3 ──────────────────────────────────────────────────────────
    original_s3_key = storage.original_key(document_id, file.filename or "upload")
    try:
        await asyncio.to_thread(
            storage.upload,
            file_bytes,
            original_s3_key,
            mime_type,
            {"document_id": document_id, "uploaded_by": current_user.clerk_user_id},
        )
    except Exception as exc:
        log.error("Storage upload failed for document_id=%s: %s", document_id, exc)
        doc.status = DocumentStatus.FAILED
        doc.error_message = f"Storage upload failed: {exc}"
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Document storage unavailable. Please try again.",
        ) from exc

    doc.s3_key_original = original_s3_key
    doc.status = DocumentStatus.UPLOADED

    # ── Pre-extraction PII scan (text/plain only, defense-in-depth) ──────────
    # For PDF/DOCX uploads we cannot read content here; the real scan runs
    # inside _process_document_pipeline once extraction has produced text.
    if mime_type == "text/plain":
        pii_result = await asyncio.to_thread(
            scan_for_pii,
            file_bytes.decode("utf-8", errors="replace"),
        )
        doc.pii_scan_passed = pii_result.passed
        if pii_result.entities:
            import json
            doc.pii_entities_found = json.dumps({
                "scanner": pii_result.scanner,
                "stage": "upload",
                "flagged_types": pii_result.flagged_types,
                "entities": [
                    {"type": e.get("Type"), "score": e.get("Score")}
                    for e in pii_result.entities[:50]
                ],
            })

    await db.commit()

    # ── Publish SQS event (only when USE_SQS=true) ────────────────────────────
    if settings.USE_SQS:
        try:
            from app.services.aws import sqs
            await asyncio.to_thread(
                sqs.publish_document_uploaded,
                document_id, workspace_id, original_s3_key, mime_type,
            )
        except Exception as exc:
            log.warning("SQS publish failed: %s", exc)

    # ── Kick off document processing — durable Celery task on RabbitMQ ──────
    # PR 2: replaces FastAPI BackgroundTasks with a Celery .delay() so a worker
    # crash mid-extraction re-queues the document rather than losing it.
    # When CELERY_TASK_ALWAYS_EAGER=true (tests) the task runs inline.
    try:
        from app.services.tasks import process_document
        process_document.delay(document_id, original_s3_key, mime_type)
    except Exception as exc:
        # Broker outage must not break the upload — fall back to in-process
        # BackgroundTasks so a single-node dev environment still works.
        log.warning(
            "Celery dispatch failed (%s) — falling back to BackgroundTasks", exc,
        )
        background_tasks.add_task(
            _process_document_pipeline, document_id, original_s3_key, mime_type
        )

    # ── Audit trail (SEC 17a-4) ────────────────────────────────────────────
    await record_audit_event(
        db,
        action="UPLOAD",
        resource_type="document",
        resource_id=document_id,
        user_id=current_user.id,
        workspace_id=workspace_id,
        request=request,
        status_code=status.HTTP_202_ACCEPTED,
        metadata={
            "filename": file.filename,
            "mime_type": mime_type,
            "size_bytes": len(file_bytes),
            "doc_type": doc_type_enum.value,
            "ticker": doc.ticker,
            "fiscal_period": fiscal_period,
        },
    )

    return DocumentUploadResponse(
        document_id=document_id,
        status=DocumentStatus.UPLOADED,
        message=(
            "Document accepted and queued for processing. "
            "Poll GET /documents/{document_id}/status for progress."
        ),
    )


# ── GET /documents ────────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=PaginatedList[DocumentOut],
    summary="List documents in a workspace",
)
async def list_documents(
    workspace_id: str = Query(...),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PaginatedList[DocumentOut]:
    """List all documents in a workspace with pagination."""
    # Verify ownership
    ws_result = await db.execute(
        select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.owner_id == current_user.id,
        )
    )
    if not ws_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found.")

    query = select(Document).where(Document.workspace_id == workspace_id)
    if status_filter:
        query = query.where(Document.status == status_filter)

    # Total count
    count_result = await db.execute(
        select(func.count()).select_from(query.subquery())
    )
    total = count_result.scalar_one()

    # Paginated results
    results = await db.execute(
        query.order_by(Document.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    docs = results.scalars().all()

    return PaginatedList(
        items=[DocumentOut.model_validate(d) for d in docs],
        total=total,
        page=page,
        page_size=page_size,
        has_next=(page * page_size) < total,
    )


# ── GET /documents/{document_id} ──────────────────────────────────────────────
@router.get(
    "/{document_id}",
    response_model=DocumentOut,
    summary="Get document details",
)
async def get_document(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    doc = await _get_document_or_404(document_id, current_user, db)
    return DocumentOut.model_validate(doc)


# ── GET /documents/{document_id}/status ──────────────────────────────────────
@router.get(
    "/{document_id}/status",
    response_model=DocumentStatusResponse,
    summary="Poll document processing status",
)
async def get_document_status(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentStatusResponse:
    """
    Lightweight polling endpoint. Frontend polls this every 2 seconds
    until status is one of: indexed | chunked | failed.
    """
    doc = await _get_document_or_404(document_id, current_user, db)

    # Count chunks
    count_result = await db.execute(
        select(func.count()).where(Chunk.document_id == document_id)
    )
    chunk_count = count_result.scalar_one()

    return DocumentStatusResponse(
        document_id=doc.id,
        status=doc.status,
        page_count=doc.page_count,
        chunk_count=chunk_count,
        error_message=doc.error_message,
        updated_at=doc.updated_at,
    )


# ── GET /documents/{document_id}/chunks ──────────────────────────────────────
@router.get(
    "/{document_id}/chunks",
    response_model=PaginatedList[ChunkOut],
    summary="List extracted chunks for a document",
)
async def list_chunks(
    document_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    chunk_type: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PaginatedList[ChunkOut]:
    await _get_document_or_404(document_id, current_user, db)

    query = select(Chunk).where(Chunk.document_id == document_id)
    if chunk_type:
        query = query.where(Chunk.chunk_type == chunk_type)

    count_result = await db.execute(
        select(func.count()).select_from(query.subquery())
    )
    total = count_result.scalar_one()

    results = await db.execute(
        query.order_by(Chunk.chunk_index)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    chunks = results.scalars().all()

    return PaginatedList(
        items=[ChunkOut.model_validate(c) for c in chunks],
        total=total,
        page=page,
        page_size=page_size,
        has_next=(page * page_size) < total,
    )


# ── PATCH /documents/{document_id} ────────────────────────────────────────────
@router.patch(
    "/{document_id}",
    response_model=DocumentOut,
    summary="Update document metadata",
)
async def update_document(
    document_id: str,
    body: DocumentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    """Allow analysts to correct doc_type, ticker, company, or fiscal period."""
    doc = await _get_document_or_404(document_id, current_user, db)

    if body.doc_type is not None:
        doc.doc_type = body.doc_type
    if body.company_name is not None:
        doc.company_name = body.company_name
    if body.ticker is not None:
        doc.ticker = body.ticker.upper()
    if body.fiscal_period is not None:
        doc.fiscal_period = body.fiscal_period

    db.add(doc)
    return DocumentOut.model_validate(doc)


# ── DELETE /documents/{document_id} ───────────────────────────────────────────
@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a document and all its data",
)
async def delete_document(
    document_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Hard delete: removes the DB row (cascades to chunks), S3 original + extracted files,
    and (Week 3) Pinecone vectors.
    """
    doc = await _get_document_or_404(document_id, current_user, db)

    # ── Count chunks before delete (needed for Pinecone ID range) ────────────
    count_result = await db.execute(
        select(func.count()).where(Chunk.document_id == document_id)
    )
    chunk_count = count_result.scalar_one()
    workspace_id = doc.workspace_id

    # Capture mutable doc fields BEFORE the delete so the audit row written
    # afterwards still has access to filename and ticker.
    audit_filename = doc.original_filename
    audit_ticker = doc.ticker

    # ── Delete storage objects (best-effort) ──────────────────────────────────
    for s3_key in filter(None, [doc.s3_key_original, doc.s3_key_extracted]):
        try:
            await asyncio.to_thread(storage.delete, s3_key)
        except Exception as exc:
            log.warning("Storage delete failed for key %r: %s", s3_key, exc)

    # ── Delete Pinecone vectors (best-effort) ─────────────────────────────────
    if chunk_count > 0:
        try:
            from app.services.document.embedder import delete_document_vectors
            await delete_document_vectors(
                document_id=document_id,
                workspace_id=workspace_id,
                chunk_count=chunk_count,
            )
        except Exception as exc:
            log.warning("Pinecone vector delete failed for %s: %s", document_id, exc)

    # ── Delete DB row (cascades to chunks) ────────────────────────────────────
    await db.delete(doc)
    await db.flush()

    # PR 2: Qdrant deletes points atomically across both dense and sparse
    # indexes — no per-workspace BM25 rebuild needed anymore.

    # ── Audit trail (SEC 17a-4) ────────────────────────────────────────────
    await record_audit_event(
        db,
        action="DELETE",
        resource_type="document",
        resource_id=document_id,
        user_id=current_user.id,
        workspace_id=workspace_id,
        request=request,
        status_code=status.HTTP_204_NO_CONTENT,
        metadata={
            "filename": audit_filename,
            "ticker": audit_ticker,
            "chunk_count": chunk_count,
        },
    )

    # Commit happens in get_db() on clean exit
