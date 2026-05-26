"""
SEC EDGAR integration — Phase 3 Week 6 Day 6-7.

Polls the SEC EDGAR submissions API for new filings on tickers our users
subscribe to. When a new filing is detected we:

  1. Write a `filing` Alert into the alerts table
  2. Update TickerSubscription.{last_edgar_check_at, last_edgar_accession,
     last_edgar_filing_url}
  3. Optionally dispatch SES emails to the subscribers

This makes the platform proactive — users find out about new 10-K/10-Q/8-K
filings without having to upload them manually.

API endpoints used (no auth required, but User-Agent header is mandatory
per https://www.sec.gov/os/accessing-edgar-data):

  GET https://www.sec.gov/files/company_tickers.json
      → {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}, ...}

  GET https://data.sec.gov/submissions/CIK{padded_cik}.json
      → {"filings": {"recent": {"form": [...], "filingDate": [...],
                                "accessionNumber": [...], "primaryDocument": [...]}}}

Rate limit: SEC asks for ≤10 req/s. We're well below that.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.config import settings

log = logging.getLogger(__name__)

EDGAR_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
EDGAR_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
EDGAR_ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data"

# Forms we surface to users (regulatory periodic + current reports)
INTERESTING_FORMS: set[str] = {"10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "20-F", "40-F"}

# Cache for ticker → CIK mapping (refreshed every poll)
_ticker_cache: dict[str, dict[str, Any]] = {}
_ticker_cache_loaded_at: Optional[datetime] = None
_TICKER_CACHE_TTL_SECONDS = 24 * 60 * 60  # refresh once a day


# ── HTTP client ───────────────────────────────────────────────────────────────
def _httpx_client():
    """Build an httpx.AsyncClient with the SEC-required User-Agent header."""
    import httpx
    return httpx.AsyncClient(
        timeout=20.0,
        headers={
            "User-Agent": settings.EDGAR_USER_AGENT,
            "Accept-Encoding": "gzip, deflate",
            "Host": "www.sec.gov",
        },
    )


# ── Ticker → CIK ──────────────────────────────────────────────────────────────
async def _refresh_ticker_cache() -> None:
    """Fetch the global tickers JSON and populate the in-memory cache."""
    global _ticker_cache, _ticker_cache_loaded_at

    async with _httpx_client() as client:
        # company_tickers.json is served from www.sec.gov, not data.sec.gov
        response = await client.get(EDGAR_TICKERS_URL)
        response.raise_for_status()
        data = response.json()

    # Normalise: {ticker_upper: {cik, title}}
    normalized: dict[str, dict[str, Any]] = {}
    for entry in data.values():
        ticker = entry.get("ticker", "").upper().strip()
        cik = entry.get("cik_str") or entry.get("cik")
        if not ticker or cik is None:
            continue
        normalized[ticker] = {
            "cik": int(cik),
            "title": entry.get("title", ""),
        }

    _ticker_cache = normalized
    _ticker_cache_loaded_at = datetime.now(timezone.utc)
    log.info("EDGAR ticker cache refreshed: %d entries", len(normalized))


def _ticker_cache_is_stale() -> bool:
    if _ticker_cache_loaded_at is None or not _ticker_cache:
        return True
    age = (datetime.now(timezone.utc) - _ticker_cache_loaded_at).total_seconds()
    return age > _TICKER_CACHE_TTL_SECONDS


async def get_cik_for_ticker(ticker: str) -> Optional[dict[str, Any]]:
    """
    Resolve a ticker symbol to its SEC CIK + company title.

    Returns {"cik": int, "title": str} or None if unknown.
    """
    if _ticker_cache_is_stale():
        try:
            await _refresh_ticker_cache()
        except Exception as exc:
            log.error("Failed to refresh EDGAR ticker cache: %s", exc)
            if not _ticker_cache:
                return None  # cache is empty AND refresh failed

    return _ticker_cache.get(ticker.upper().strip())


def _padded_cik(cik: int) -> str:
    return f"{int(cik):010d}"


# ── Recent filings ────────────────────────────────────────────────────────────
async def get_recent_filings(
    cik: int,
    *,
    form_filter: Optional[set[str]] = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """
    Pull the most recent filings for a given CIK from data.sec.gov.

    Returns a list of dicts (newest first):
        [{
            "form": "10-K",
            "filing_date": "2024-11-01",
            "accession": "0000320193-24-000123",
            "primary_document": "aapl-20240928.htm",
            "primary_doc_url": "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm",
            "report_date": "2024-09-28",
        }, ...]
    """
    import httpx

    url = EDGAR_SUBMISSIONS_URL.format(cik=_padded_cik(cik))
    # data.sec.gov requires a different Host header than www.sec.gov
    async with httpx.AsyncClient(
        timeout=20.0,
        headers={
            "User-Agent": settings.EDGAR_USER_AGENT,
            "Accept-Encoding": "gzip, deflate",
            "Host": "data.sec.gov",
        },
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
        data = response.json()

    recent = (data.get("filings") or {}).get("recent") or {}
    forms = recent.get("form", []) or []
    dates = recent.get("filingDate", []) or []
    accessions = recent.get("accessionNumber", []) or []
    primary_docs = recent.get("primaryDocument", []) or []
    report_dates = recent.get("reportDate", []) or []

    filings: list[dict[str, Any]] = []
    for i in range(len(forms)):
        form = forms[i]
        if form_filter is not None and form not in form_filter:
            continue
        accession = accessions[i] if i < len(accessions) else ""
        primary = primary_docs[i] if i < len(primary_docs) else ""
        accession_no_dashes = accession.replace("-", "")
        url = (
            f"{EDGAR_ARCHIVES_BASE}/{int(cik)}/{accession_no_dashes}/{primary}"
            if accession_no_dashes and primary else None
        )
        filings.append({
            "form": form,
            "filing_date": dates[i] if i < len(dates) else None,
            "accession": accession,
            "primary_document": primary,
            "primary_doc_url": url,
            "report_date": report_dates[i] if i < len(report_dates) else None,
        })
        if len(filings) >= limit:
            break

    return filings


# ── Polling logic ─────────────────────────────────────────────────────────────
def _build_filing_alert_payload(
    *,
    ticker: str,
    company_name: Optional[str],
    filing: dict[str, Any],
) -> dict[str, str]:
    """Build title + description for a filing alert."""
    company = company_name or ticker
    form = filing["form"]
    period = filing.get("report_date") or filing.get("filing_date") or "n/a"

    title = f"New {form} filed — {ticker}"
    description = (
        f"{company} ({ticker}) filed a {form} on {filing.get('filing_date')} "
        f"covering reporting period {period}. Accession: {filing['accession']}. "
        f"View on EDGAR: {filing.get('primary_doc_url') or 'see SEC.gov'}."
    )
    return {"title": title, "description": description}


async def poll_subscription(
    subscription: Any,
    db: Any,
    *,
    create_alerts: bool = True,
) -> dict[str, Any]:
    """
    Poll a single TickerSubscription for new EDGAR filings.

    Side effects:
      - Updates subscription.last_edgar_check_at and (if new filing detected)
        last_edgar_accession + last_edgar_filing_url.
      - Inserts up to one Alert per newly-detected filing into the alerts table.

    Returns a summary dict with counts and the new filings discovered.
    """
    from app.db.models import Alert

    summary = {
        "ticker": subscription.ticker,
        "checked": True,
        "new_filings": 0,
        "alerts_created": 0,
        "error": None,
    }

    try:
        info = await get_cik_for_ticker(subscription.ticker)
        if info is None:
            summary["error"] = "ticker not found in EDGAR"
            subscription.last_edgar_check_at = datetime.now(timezone.utc)
            return summary

        if not subscription.company_name and info.get("title"):
            subscription.company_name = info["title"]

        filings = await get_recent_filings(
            info["cik"], form_filter=INTERESTING_FORMS, limit=10,
        )
        subscription.last_edgar_check_at = datetime.now(timezone.utc)

        if not filings:
            return summary

        # Find filings newer than last_edgar_accession.
        # SEC accession numbers sort lexicographically by date.
        last_seen = subscription.last_edgar_accession or ""
        new_filings = [f for f in filings if f["accession"] > last_seen]

        # First-time poll (no last_edgar_accession): just record the latest
        # without alerting on the entire backlog.
        if not last_seen:
            latest = filings[0]
            subscription.last_edgar_accession = latest["accession"]
            subscription.last_edgar_filing_url = latest.get("primary_doc_url")
            log.info(
                "EDGAR baseline set for %s: latest=%s (%s)",
                subscription.ticker, latest["accession"], latest["form"],
            )
            return summary

        if not new_filings:
            return summary

        # Newest first
        new_filings.sort(key=lambda f: f["accession"], reverse=True)
        summary["new_filings"] = len(new_filings)

        # Update subscription state to the newest accession
        newest = new_filings[0]
        subscription.last_edgar_accession = newest["accession"]
        subscription.last_edgar_filing_url = newest.get("primary_doc_url")

        if create_alerts:
            for filing in new_filings[:5]:  # Cap at 5 to avoid alert storms
                payload = _build_filing_alert_payload(
                    ticker=subscription.ticker,
                    company_name=subscription.company_name or info.get("title"),
                    filing=filing,
                )
                alert = Alert(
                    workspace_id=subscription.workspace_id,
                    user_id=subscription.user_id,
                    document_id=None,
                    ticker=subscription.ticker,
                    alert_type="filing",
                    severity="info",
                    title=payload["title"],
                    description=payload["description"],
                )
                db.add(alert)
                summary["alerts_created"] += 1

        return summary

    except Exception as exc:
        log.exception("EDGAR poll failed for ticker %s: %s", subscription.ticker, exc)
        summary["error"] = str(exc)
        return summary


async def poll_all_subscriptions(
    db: Any,
    *,
    dispatch_emails: bool = True,
) -> dict[str, Any]:
    """
    Poll EDGAR for every active TickerSubscription with subscribe_filing=True.

    Args:
        db: AsyncSession — caller commits at the end.
        dispatch_emails: whether to also send SES emails for new filings.

    Returns:
        {"subscriptions_checked": int, "total_new_filings": int,
         "alerts_created": int, "emails_sent": int, "results": [...]}
    """
    from sqlalchemy import select

    from app.db.models import Alert, TickerSubscription

    subs = (await db.execute(
        select(TickerSubscription).where(
            TickerSubscription.active.is_(True),
            TickerSubscription.subscribe_filing.is_(True),
        )
    )).scalars().all()

    overall = {
        "subscriptions_checked": 0,
        "total_new_filings": 0,
        "alerts_created": 0,
        "emails_sent": 0,
        "results": [],
    }

    for sub in subs:
        # Throttle ~5 req/s to stay well under SEC's 10 req/s limit
        await asyncio.sleep(0.2)
        result = await poll_subscription(sub, db, create_alerts=True)
        overall["subscriptions_checked"] += 1
        overall["total_new_filings"] += result["new_filings"]
        overall["alerts_created"] += result["alerts_created"]
        overall["results"].append(result)

    # Flush so newly-created Alert rows have IDs
    await db.flush()

    if dispatch_emails and overall["alerts_created"] > 0:
        from app.services.alerts import dispatch_alert_emails

        new_filing_alerts = (await db.execute(
            select(Alert).where(
                Alert.alert_type == "filing",
                Alert.email_sent.is_(False),
            ).order_by(Alert.created_at.desc()).limit(overall["alerts_created"])
        )).scalars().all()

        try:
            overall["emails_sent"] = await dispatch_alert_emails(new_filing_alerts, db)
        except Exception as exc:
            log.warning("Email dispatch for filing alerts failed: %s", exc)

    log.info(
        "EDGAR poll complete: subs=%d new_filings=%d alerts=%d emails=%d",
        overall["subscriptions_checked"], overall["total_new_filings"],
        overall["alerts_created"], overall["emails_sent"],
    )
    return overall


# ── Background scheduler ──────────────────────────────────────────────────────
_poller_task: Optional[asyncio.Task] = None


async def _poller_loop() -> None:
    """Background loop that polls EDGAR every EDGAR_POLL_INTERVAL_SECONDS."""
    from app.db.session import AsyncSessionLocal

    log.info(
        "EDGAR poller started: interval=%ds user-agent=%r",
        settings.EDGAR_POLL_INTERVAL_SECONDS, settings.EDGAR_USER_AGENT,
    )

    # Initial delay so we don't pile on at startup
    await asyncio.sleep(30)

    while True:
        try:
            async with AsyncSessionLocal() as db:
                await poll_all_subscriptions(db, dispatch_emails=True)
                await db.commit()
        except asyncio.CancelledError:
            log.info("EDGAR poller cancelled")
            raise
        except Exception as exc:
            log.exception("EDGAR poller iteration failed: %s", exc)

        await asyncio.sleep(settings.EDGAR_POLL_INTERVAL_SECONDS)


def start_poller() -> None:
    """Kick off the background poller task. Idempotent."""
    global _poller_task
    if _poller_task is not None and not _poller_task.done():
        return
    if not settings.USE_EDGAR_POLLER:
        log.info("EDGAR poller disabled (USE_EDGAR_POLLER=false)")
        return
    _poller_task = asyncio.create_task(_poller_loop(), name="edgar-poller")
    log.info("EDGAR poller task scheduled")


async def stop_poller() -> None:
    """Cancel the background poller (called from app shutdown)."""
    global _poller_task
    if _poller_task is None:
        return
    _poller_task.cancel()
    try:
        await _poller_task
    except (asyncio.CancelledError, Exception):
        pass
    _poller_task = None
    log.info("EDGAR poller stopped")
