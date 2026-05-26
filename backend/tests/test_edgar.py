"""
Tests for SEC EDGAR poller — Phase 3 Week 6 Day 6-7.

All HTTP calls to sec.gov are mocked so the tests are deterministic,
offline, and don't hit SEC's rate limits.
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

from app.db.models import Alert, TickerSubscription, Workspace


# ── Mock EDGAR responses ──────────────────────────────────────────────────────
MOCK_TICKERS_JSON = {
    "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
    "1": {"cik_str": 789019, "ticker": "MSFT", "title": "Microsoft Corporation"},
}

MOCK_AAPL_SUBMISSIONS = {
    "cik": "0000320193",
    "name": "Apple Inc.",
    "filings": {
        "recent": {
            "form": ["10-K", "10-Q", "8-K", "DEF 14A"],
            "filingDate": ["2024-11-01", "2024-08-02", "2024-07-15", "2024-04-10"],
            "accessionNumber": [
                "0000320193-24-000123",
                "0000320193-24-000098",
                "0000320193-24-000080",
                "0000320193-24-000050",
            ],
            "primaryDocument": [
                "aapl-20240928.htm",
                "aapl-20240629.htm",
                "ex991.htm",
                "proxy.htm",
            ],
            "reportDate": ["2024-09-28", "2024-06-29", "2024-07-15", "2024-04-10"],
        }
    },
}


# ── Fixtures ──────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def workspace_with_subscription(db_session):
    """Workspace + a TickerSubscription for AAPL with no prior accession recorded."""
    ws = Workspace(id="ws-edgar-test", owner_id="test-user-id", name="Edgar WS", is_default=True)
    db_session.add(ws)
    await db_session.flush()

    sub = TickerSubscription(
        id="sub-aapl",
        user_id="test-user-id",
        workspace_id=ws.id,
        ticker="AAPL",
        company_name=None,  # Will be auto-populated from EDGAR
        subscribe_anomaly=False,
        subscribe_sentiment=False,
        subscribe_filing=True,
        subscribe_regulatory=False,
        email_notifications=False,  # No email side-effects in test
        active=True,
        last_edgar_accession=None,
    )
    db_session.add(sub)
    await db_session.commit()
    return {"workspace": ws, "subscription": sub}


# ── Helpers to mock the EDGAR client ──────────────────────────────────────────
def _patch_edgar_http():
    """Mocks the two HTTP-calling helpers in services/edgar.py."""

    async def fake_refresh_cache():
        # Populate the module-level cache directly
        from app.services import edgar
        edgar._ticker_cache = {
            entry["ticker"]: {"cik": int(entry["cik_str"]), "title": entry["title"]}
            for entry in MOCK_TICKERS_JSON.values()
        }
        edgar._ticker_cache_loaded_at = datetime.now(timezone.utc)

    async def fake_recent(cik, form_filter=None, limit=20):
        from app.services.edgar import INTERESTING_FORMS
        recent = MOCK_AAPL_SUBMISSIONS["filings"]["recent"]
        out = []
        for i, form in enumerate(recent["form"]):
            if form_filter is not None and form not in form_filter:
                continue
            accession = recent["accessionNumber"][i]
            primary = recent["primaryDocument"][i]
            out.append({
                "form": form,
                "filing_date": recent["filingDate"][i],
                "accession": accession,
                "primary_document": primary,
                "primary_doc_url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-','')}/{primary}",
                "report_date": recent["reportDate"][i],
            })
            if len(out) >= limit:
                break
        return out

    return {
        "app.services.edgar._refresh_ticker_cache": fake_refresh_cache,
        "app.services.edgar.get_recent_filings": fake_recent,
    }


# ── Pure-function tests ───────────────────────────────────────────────────────
def test_padded_cik():
    from app.services.edgar import _padded_cik

    assert _padded_cik(320193) == "0000320193"
    assert _padded_cik(1) == "0000000001"


def test_filing_alert_payload():
    from app.services.edgar import _build_filing_alert_payload

    filing = {
        "form": "10-K",
        "filing_date": "2024-11-01",
        "accession": "0000320193-24-000123",
        "primary_doc_url": "https://www.sec.gov/test.htm",
        "report_date": "2024-09-28",
    }
    payload = _build_filing_alert_payload(
        ticker="AAPL", company_name="Apple Inc.", filing=filing,
    )
    assert "10-K" in payload["title"]
    assert "AAPL" in payload["title"]
    assert "Apple Inc." in payload["description"]
    assert "0000320193-24-000123" in payload["description"]


# ── Integration tests with mocked EDGAR calls ─────────────────────────────────
@pytest.mark.asyncio
async def test_poll_subscription_first_time_records_baseline_no_alerts(
    db_session, workspace_with_subscription
):
    """
    First-ever poll for a subscription should record the latest accession
    as a baseline but NOT alert on the entire backlog.
    """
    from app.services import edgar
    sub = workspace_with_subscription["subscription"]
    patches = _patch_edgar_http()

    with patch(list(patches.keys())[0], patches[list(patches.keys())[0]]), \
         patch(list(patches.keys())[1], patches[list(patches.keys())[1]]):
        result = await edgar.poll_subscription(sub, db_session, create_alerts=True)
        await db_session.commit()
        await db_session.refresh(sub)

    assert result["error"] is None
    # No alerts on first sighting
    assert result["alerts_created"] == 0
    # Baseline was recorded
    assert sub.last_edgar_accession == "0000320193-24-000123"  # Newest 10-K
    assert sub.last_edgar_filing_url is not None
    assert "aapl-20240928.htm" in sub.last_edgar_filing_url
    # Auto-populated company_name from EDGAR
    assert sub.company_name == "Apple Inc."
    assert sub.last_edgar_check_at is not None


@pytest.mark.asyncio
async def test_poll_subscription_detects_new_filing(db_session, workspace_with_subscription):
    """
    With a prior accession recorded, a new filing should produce an Alert.
    """
    from sqlalchemy import select

    from app.services import edgar
    sub = workspace_with_subscription["subscription"]

    # Pretend we last saw the OLD accession (the 8-K from July) — anything
    # newer should be flagged as new.
    sub.last_edgar_accession = "0000320193-24-000080"
    await db_session.commit()

    patches = _patch_edgar_http()

    with patch(list(patches.keys())[0], patches[list(patches.keys())[0]]), \
         patch(list(patches.keys())[1], patches[list(patches.keys())[1]]):
        result = await edgar.poll_subscription(sub, db_session, create_alerts=True)
        await db_session.commit()
        await db_session.refresh(sub)

    assert result["error"] is None
    # 10-K (123) and 10-Q (098) are both newer than 080
    assert result["new_filings"] == 2
    assert result["alerts_created"] == 2
    # Subscription state advances to the newest accession
    assert sub.last_edgar_accession == "0000320193-24-000123"

    # Verify alerts were persisted
    alerts = (await db_session.execute(
        select(Alert).where(Alert.ticker == "AAPL", Alert.alert_type == "filing")
    )).scalars().all()
    assert len(alerts) == 2
    titles = [a.title for a in alerts]
    assert any("10-K" in t for t in titles)
    assert any("10-Q" in t for t in titles)
    # Severity is info for filing alerts
    assert all(a.severity == "info" for a in alerts)


@pytest.mark.asyncio
async def test_poll_subscription_no_changes(db_session, workspace_with_subscription):
    """If nothing has changed since last poll, no alerts are created."""
    from app.services import edgar
    sub = workspace_with_subscription["subscription"]
    sub.last_edgar_accession = "0000320193-24-000123"  # Already at newest
    await db_session.commit()

    patches = _patch_edgar_http()
    with patch(list(patches.keys())[0], patches[list(patches.keys())[0]]), \
         patch(list(patches.keys())[1], patches[list(patches.keys())[1]]):
        result = await edgar.poll_subscription(sub, db_session, create_alerts=True)
        await db_session.commit()

    assert result["new_filings"] == 0
    assert result["alerts_created"] == 0


@pytest.mark.asyncio
async def test_poll_subscription_unknown_ticker(db_session, workspace_with_subscription):
    """Tickers not in EDGAR's lookup table should fail gracefully."""
    from app.services import edgar
    sub = workspace_with_subscription["subscription"]
    sub.ticker = "FAKE"
    await db_session.commit()

    patches = _patch_edgar_http()
    with patch(list(patches.keys())[0], patches[list(patches.keys())[0]]), \
         patch(list(patches.keys())[1], patches[list(patches.keys())[1]]):
        result = await edgar.poll_subscription(sub, db_session, create_alerts=True)
        await db_session.commit()

    assert result["error"] is not None
    assert "not found" in result["error"].lower()
    assert result["alerts_created"] == 0


@pytest.mark.asyncio
async def test_poll_all_subscriptions_aggregates(db_session, workspace_with_subscription):
    """Whole-poller smoke test."""
    from app.services import edgar
    sub = workspace_with_subscription["subscription"]
    sub.last_edgar_accession = "0000320193-24-000080"  # Will pick up 2 new
    await db_session.commit()

    patches = _patch_edgar_http()

    # Also short-circuit dispatch_emails so we don't hit SES
    with patch(list(patches.keys())[0], patches[list(patches.keys())[0]]), \
         patch(list(patches.keys())[1], patches[list(patches.keys())[1]]), \
         patch("app.services.alerts.dispatch_alert_emails", AsyncMock(return_value=0)):
        overall = await edgar.poll_all_subscriptions(db_session, dispatch_emails=False)
        await db_session.commit()

    assert overall["subscriptions_checked"] == 1
    assert overall["total_new_filings"] == 2
    assert overall["alerts_created"] == 2


# ── HTTP-level test: the poll endpoint ────────────────────────────────────────
@pytest.mark.asyncio
async def test_post_alerts_edgar_poll_endpoint(client, db_session, workspace_with_subscription):
    """POST /alerts/edgar/poll runs the per-user poller inline."""
    sub = workspace_with_subscription["subscription"]
    sub.last_edgar_accession = "0000320193-24-000080"
    await db_session.commit()

    patches = _patch_edgar_http()
    with patch(list(patches.keys())[0], patches[list(patches.keys())[0]]), \
         patch(list(patches.keys())[1], patches[list(patches.keys())[1]]):
        response = await client.post("/api/v1/alerts/edgar/poll")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["subscriptions_checked"] == 1
    assert body["total_new_filings"] == 2
    assert body["alerts_created"] == 2
