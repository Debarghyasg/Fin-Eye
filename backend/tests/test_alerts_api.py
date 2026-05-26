"""
Tests for /api/v1/alerts and /api/v1/alerts/subscriptions — Phase 3 Week 6.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
import pytest_asyncio

from app.db.models import Alert, TickerSubscription, Workspace


@pytest_asyncio.fixture
async def alerts_workspace(db_session):
    ws = Workspace(id="ws-alerts-test", owner_id="test-user-id", name="Alerts WS", is_default=True)
    db_session.add(ws)
    await db_session.flush()

    # Seed 3 alerts: 2 unread (one high, one low) and 1 read medium
    db_session.add_all([
        Alert(
            id="alert-1", workspace_id=ws.id, user_id="test-user-id",
            ticker="AAPL", alert_type="anomaly", severity="high",
            title="Revenue spike", description="Revenue 4σ above mean",
            metric_name="revenue", metric_value=600000.0, z_score=4.2,
            historical_mean=290000.0, historical_stdev=40000.0, sample_size=4,
            read=False,
        ),
        Alert(
            id="alert-2", workspace_id=ws.id, user_id="test-user-id",
            ticker="MSFT", alert_type="sentiment", severity="low",
            title="Cautious tone", description="Sentiment shifted from 0.71 to 0.5",
            read=False,
        ),
        Alert(
            id="alert-3", workspace_id=ws.id, user_id="test-user-id",
            ticker="AAPL", alert_type="filing", severity="medium",
            title="New 10-K available", description="FY2024 10-K filed",
            read=True,
        ),
    ])
    await db_session.commit()
    return ws


# ── List alerts ──────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_list_alerts_default(client, alerts_workspace):
    response = await client.get("/api/v1/alerts")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["unread"] == 2
    assert len(body["items"]) == 3


@pytest.mark.asyncio
async def test_list_alerts_unread_only(client, alerts_workspace):
    response = await client.get("/api/v1/alerts?unread_only=true")
    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 2
    assert all(item["read"] is False for item in body["items"])
    # Unread count remains workspace-wide (still 2)
    assert body["unread"] == 2


@pytest.mark.asyncio
async def test_list_alerts_filter_by_ticker(client, alerts_workspace):
    response = await client.get("/api/v1/alerts?ticker=AAPL")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 2
    assert all(item["ticker"] == "AAPL" for item in items)


@pytest.mark.asyncio
async def test_list_alerts_filter_by_severity(client, alerts_workspace):
    response = await client.get("/api/v1/alerts?severity=high")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["title"] == "Revenue spike"
    assert items[0]["z_score"] == pytest.approx(4.2)


# ── Mark read ────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_mark_alert_read(client, alerts_workspace):
    response = await client.patch("/api/v1/alerts/alert-1/read")
    assert response.status_code == 200
    assert response.json()["read"] is True

    # Unread count drops to 1
    list_resp = await client.get("/api/v1/alerts")
    assert list_resp.json()["unread"] == 1


@pytest.mark.asyncio
async def test_mark_alert_read_404(client, alerts_workspace):
    response = await client.patch("/api/v1/alerts/does-not-exist/read")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_mark_all_read(client, alerts_workspace):
    response = await client.post("/api/v1/alerts/read-all")
    assert response.status_code == 200
    assert response.json()["updated"] == 2  # only 2 were unread

    list_resp = await client.get("/api/v1/alerts")
    assert list_resp.json()["unread"] == 0


# ── Subscriptions ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_create_and_list_subscription(client, alerts_workspace):
    create = await client.post(
        "/api/v1/alerts/subscriptions",
        json={
            "workspace_id": alerts_workspace.id,
            "ticker": "tsla",  # lowercase: should be uppercased server-side
            "company_name": "Tesla Inc.",
            "subscribe_anomaly": True,
            "subscribe_filing": True,
            "subscribe_regulatory": False,
        },
    )
    assert create.status_code == 201
    sub = create.json()
    assert sub["ticker"] == "TSLA"
    assert sub["company_name"] == "Tesla Inc."
    assert sub["active"] is True

    # List
    listing = await client.get("/api/v1/alerts/subscriptions")
    assert listing.status_code == 200
    items = listing.json()
    assert len(items) == 1
    assert items[0]["ticker"] == "TSLA"


@pytest.mark.asyncio
async def test_create_subscription_idempotent(client, alerts_workspace):
    """Creating a sub for an existing ticker should reactivate / update it."""
    payload = {
        "workspace_id": alerts_workspace.id,
        "ticker": "AAPL",
        "company_name": "Apple Inc.",
    }
    first = await client.post("/api/v1/alerts/subscriptions", json=payload)
    assert first.status_code == 201
    first_id = first.json()["id"]

    # Second call same ticker → same row, refreshed
    second = await client.post(
        "/api/v1/alerts/subscriptions",
        json={**payload, "subscribe_filing": False},
    )
    assert second.status_code == 201
    assert second.json()["id"] == first_id
    assert second.json()["subscribe_filing"] is False


@pytest.mark.asyncio
async def test_update_subscription_toggles(client, alerts_workspace):
    create = await client.post(
        "/api/v1/alerts/subscriptions",
        json={"workspace_id": alerts_workspace.id, "ticker": "GOOG"},
    )
    sub_id = create.json()["id"]

    # Pause it
    update = await client.patch(
        f"/api/v1/alerts/subscriptions/{sub_id}",
        json={"active": False, "subscribe_sentiment": False},
    )
    assert update.status_code == 200
    body = update.json()
    assert body["active"] is False
    assert body["subscribe_sentiment"] is False
    # Other fields unchanged
    assert body["subscribe_anomaly"] is True


@pytest.mark.asyncio
async def test_delete_subscription(client, alerts_workspace):
    create = await client.post(
        "/api/v1/alerts/subscriptions",
        json={"workspace_id": alerts_workspace.id, "ticker": "NVDA"},
    )
    sub_id = create.json()["id"]

    delete = await client.delete(f"/api/v1/alerts/subscriptions/{sub_id}")
    assert delete.status_code == 204

    # Subsequent fetch returns empty
    listing = await client.get("/api/v1/alerts/subscriptions")
    assert all(s["ticker"] != "NVDA" for s in listing.json())


@pytest.mark.asyncio
async def test_subscription_workspace_validation(client, alerts_workspace):
    """Unknown workspace ID → 404."""
    response = await client.post(
        "/api/v1/alerts/subscriptions",
        json={"workspace_id": "nonexistent-ws", "ticker": "META"},
    )
    assert response.status_code == 404
