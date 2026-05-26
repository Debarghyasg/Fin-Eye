"""
Alerts + ticker subscriptions API — Phase 3 Week 6 Day 4-5.

GET    /api/v1/alerts                       — list alerts for the current user
PATCH  /api/v1/alerts/{id}/read             — mark a single alert as read
POST   /api/v1/alerts/read-all              — mark every alert read

GET    /api/v1/alerts/subscriptions         — list the user's ticker subscriptions
POST   /api/v1/alerts/subscriptions         — subscribe to a new ticker
PATCH  /api/v1/alerts/subscriptions/{id}    — update toggles / pause
DELETE /api/v1/alerts/subscriptions/{id}    — unsubscribe (hard delete)
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.models import Alert, TickerSubscription, User, Workspace
from app.db.schemas import (
    AlertListResponse,
    AlertOut,
    TickerSubscriptionCreate,
    TickerSubscriptionOut,
    TickerSubscriptionUpdate,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/alerts", tags=["alerts"])


# ── GET /alerts ───────────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=AlertListResponse,
    summary="List alerts for the current user's workspaces",
)
async def list_alerts(
    workspace_id: Optional[str] = Query(None, description="Filter by workspace"),
    ticker: Optional[str] = Query(None, description="Filter by ticker"),
    alert_type: Optional[str] = Query(None, description="anomaly|sentiment|regulatory|filing"),
    severity: Optional[str] = Query(None, description="high|medium|low|info"),
    unread_only: bool = Query(False, description="Return only unread alerts"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AlertListResponse:
    """List alerts visible to the current user, scoped to their workspaces."""
    base_query = (
        select(Alert)
        .join(Workspace, Alert.workspace_id == Workspace.id)
        .where(Workspace.owner_id == current_user.id)
    )

    if workspace_id:
        base_query = base_query.where(Alert.workspace_id == workspace_id)
    if ticker:
        base_query = base_query.where(Alert.ticker == ticker.upper())
    if alert_type:
        base_query = base_query.where(Alert.alert_type == alert_type)
    if severity:
        base_query = base_query.where(Alert.severity == severity)
    if unread_only:
        base_query = base_query.where(Alert.read.is_(False))

    # Total + unread counts (use the same scoping but ignore offset/limit)
    total = (await db.execute(
        select(func.count()).select_from(base_query.subquery())
    )).scalar_one()

    unread_query = (
        select(func.count())
        .select_from(Alert)
        .join(Workspace, Alert.workspace_id == Workspace.id)
        .where(
            Workspace.owner_id == current_user.id,
            Alert.read.is_(False),
        )
    )
    if workspace_id:
        unread_query = unread_query.where(Alert.workspace_id == workspace_id)
    unread_count = (await db.execute(unread_query)).scalar_one()

    # Paginated rows
    rows = (await db.execute(
        base_query.order_by(Alert.created_at.desc()).offset(offset).limit(limit)
    )).scalars().all()

    return AlertListResponse(
        items=[AlertOut.model_validate(a) for a in rows],
        total=total,
        unread=unread_count,
    )


# ── PATCH /alerts/{id}/read ───────────────────────────────────────────────────
@router.patch(
    "/{alert_id}/read",
    response_model=AlertOut,
    summary="Mark an alert as read",
)
async def mark_alert_read(
    alert_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AlertOut:
    result = await db.execute(
        select(Alert)
        .join(Workspace, Alert.workspace_id == Workspace.id)
        .where(
            Alert.id == alert_id,
            Workspace.owner_id == current_user.id,
        )
    )
    alert = result.scalar_one_or_none()
    if alert is None:
        raise HTTPException(404, "Alert not found")

    alert.read = True
    await db.commit()
    await db.refresh(alert)
    return AlertOut.model_validate(alert)


# ── POST /alerts/read-all ─────────────────────────────────────────────────────
@router.post(
    "/read-all",
    summary="Mark every alert in the current user's scope as read",
)
async def mark_all_read(
    workspace_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Find IDs scoped to the user (and optional workspace)
    id_query = (
        select(Alert.id)
        .join(Workspace, Alert.workspace_id == Workspace.id)
        .where(
            Workspace.owner_id == current_user.id,
            Alert.read.is_(False),
        )
    )
    if workspace_id:
        id_query = id_query.where(Alert.workspace_id == workspace_id)

    ids = [row[0] for row in (await db.execute(id_query)).all()]
    if ids:
        await db.execute(
            update(Alert).where(Alert.id.in_(ids)).values(read=True)
        )
        await db.commit()

    return {"updated": len(ids)}


# ── Ticker subscriptions ──────────────────────────────────────────────────────
@router.get(
    "/subscriptions",
    response_model=list[TickerSubscriptionOut],
    summary="List the current user's ticker subscriptions",
)
async def list_subscriptions(
    workspace_id: Optional[str] = Query(None),
    active_only: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TickerSubscriptionOut]:
    query = select(TickerSubscription).where(TickerSubscription.user_id == current_user.id)
    if workspace_id:
        query = query.where(TickerSubscription.workspace_id == workspace_id)
    if active_only:
        query = query.where(TickerSubscription.active.is_(True))

    rows = (await db.execute(query.order_by(TickerSubscription.ticker))).scalars().all()
    return [TickerSubscriptionOut.model_validate(r) for r in rows]


@router.post(
    "/subscriptions",
    response_model=TickerSubscriptionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Subscribe to a new ticker",
)
async def create_subscription(
    body: TickerSubscriptionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TickerSubscriptionOut:
    # Verify workspace ownership
    ws = (await db.execute(
        select(Workspace).where(
            Workspace.id == body.workspace_id,
            Workspace.owner_id == current_user.id,
        )
    )).scalar_one_or_none()
    if ws is None:
        raise HTTPException(404, "Workspace not found or access denied")

    ticker_upper = body.ticker.upper().strip()

    # Idempotency: if a subscription for this ticker already exists, update + return it
    existing = (await db.execute(
        select(TickerSubscription).where(
            TickerSubscription.user_id == current_user.id,
            TickerSubscription.ticker == ticker_upper,
        )
    )).scalar_one_or_none()

    if existing is not None:
        existing.active = True
        existing.workspace_id = body.workspace_id
        if body.company_name:
            existing.company_name = body.company_name
        existing.subscribe_anomaly = body.subscribe_anomaly
        existing.subscribe_sentiment = body.subscribe_sentiment
        existing.subscribe_filing = body.subscribe_filing
        existing.subscribe_regulatory = body.subscribe_regulatory
        existing.email_notifications = body.email_notifications
        await db.commit()
        await db.refresh(existing)
        return TickerSubscriptionOut.model_validate(existing)

    sub = TickerSubscription(
        user_id=current_user.id,
        workspace_id=body.workspace_id,
        ticker=ticker_upper,
        company_name=body.company_name,
        subscribe_anomaly=body.subscribe_anomaly,
        subscribe_sentiment=body.subscribe_sentiment,
        subscribe_filing=body.subscribe_filing,
        subscribe_regulatory=body.subscribe_regulatory,
        email_notifications=body.email_notifications,
        active=True,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return TickerSubscriptionOut.model_validate(sub)


@router.patch(
    "/subscriptions/{subscription_id}",
    response_model=TickerSubscriptionOut,
    summary="Update a ticker subscription",
)
async def update_subscription(
    subscription_id: str,
    body: TickerSubscriptionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TickerSubscriptionOut:
    sub = (await db.execute(
        select(TickerSubscription).where(
            TickerSubscription.id == subscription_id,
            TickerSubscription.user_id == current_user.id,
        )
    )).scalar_one_or_none()
    if sub is None:
        raise HTTPException(404, "Subscription not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(sub, field, value)

    await db.commit()
    await db.refresh(sub)
    return TickerSubscriptionOut.model_validate(sub)


@router.delete(
    "/subscriptions/{subscription_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,  # FastAPI 0.111: prevent auto-derivation from `-> None` annotation
    summary="Unsubscribe from a ticker",
)
async def delete_subscription(
    subscription_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    sub = (await db.execute(
        select(TickerSubscription).where(
            TickerSubscription.id == subscription_id,
            TickerSubscription.user_id == current_user.id,
        )
    )).scalar_one_or_none()
    if sub is None:
        raise HTTPException(404, "Subscription not found")

    await db.delete(sub)
    await db.commit()



# ── POST /alerts/edgar/poll (manual trigger) ─────────────────────────────────
@router.post(
    "/edgar/poll",
    summary="Manually trigger SEC EDGAR poll for the user's subscriptions",
)
async def trigger_edgar_poll(
    dispatch_emails: bool = Query(False, description="Send SES emails for new filings"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Run the SEC EDGAR poller against the current user's active subscriptions
    immediately. Useful for testing and on-demand refresh — the background
    scheduler runs hourly when USE_EDGAR_POLLER is enabled.

    Returns a per-ticker summary of new filings, alerts created, and emails sent.
    """
    from sqlalchemy import select as _select

    from app.services.edgar import poll_subscription

    subs = (await db.execute(
        _select(TickerSubscription).where(
            TickerSubscription.user_id == current_user.id,
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
        result = await poll_subscription(sub, db, create_alerts=True)
        overall["subscriptions_checked"] += 1
        overall["total_new_filings"] += result["new_filings"]
        overall["alerts_created"] += result["alerts_created"]
        overall["results"].append(result)

    await db.flush()

    if dispatch_emails and overall["alerts_created"] > 0:
        from app.services.alerts import dispatch_alert_emails

        new_alerts = (await db.execute(
            _select(Alert)
            .where(
                Alert.alert_type == "filing",
                Alert.user_id == current_user.id,
                Alert.email_sent.is_(False),
            )
            .order_by(Alert.created_at.desc())
            .limit(overall["alerts_created"])
        )).scalars().all()
        try:
            overall["emails_sent"] = await dispatch_alert_emails(new_alerts, db)
        except Exception as exc:
            log.warning("EDGAR email dispatch failed: %s", exc)

    await db.commit()
    return overall
