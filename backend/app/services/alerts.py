"""
Alert dispatcher — Phase 3 Week 6 Day 4-5.

Glues anomaly detection results to:
  - Email notifications (AWS SES)
  - In-app notifications (already in DB via Alert table — frontend polls /alerts)
  - Email-sent tracking (Alert.email_sent flag)

Designed to be called as a best-effort background step AFTER anomaly detection
has committed its alerts. Never raises — failures are logged.
"""
from __future__ import annotations

import logging
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


def _alert_to_dict(alert: Any) -> dict[str, Any]:
    """Convert an Alert ORM object to a serialisable dict."""
    return {
        "id": alert.id,
        "title": alert.title,
        "description": alert.description,
        "severity": alert.severity,
        "alert_type": alert.alert_type,
        "ticker": alert.ticker,
        "metric_name": alert.metric_name,
        "metric_value": alert.metric_value,
        "z_score": alert.z_score,
        "historical_mean": alert.historical_mean,
        "historical_stdev": alert.historical_stdev,
        "sample_size": alert.sample_size,
        "created_at": alert.created_at,
    }


async def _find_recipients_for_alert(
    db: AsyncSession,
    alert: Any,
) -> list[tuple[str, str | None]]:
    """
    Return [(email, company_name)] pairs for users subscribed to alert.ticker
    and opted in to this alert_type.

    Active subscriptions only; respects per-channel toggles
    (subscribe_anomaly / sentiment / filing / regulatory).
    """
    from app.db.models import TickerSubscription, User

    if not alert.ticker:
        return []

    # Map alert_type → subscription column
    type_to_col = {
        "anomaly": TickerSubscription.subscribe_anomaly,
        "sentiment": TickerSubscription.subscribe_sentiment,
        "filing": TickerSubscription.subscribe_filing,
        "regulatory": TickerSubscription.subscribe_regulatory,
    }
    type_filter = type_to_col.get(alert.alert_type)
    if type_filter is None:
        return []

    query = (
        select(TickerSubscription, User.email)
        .join(User, TickerSubscription.user_id == User.id)
        .where(
            TickerSubscription.ticker == alert.ticker,
            TickerSubscription.active.is_(True),
            TickerSubscription.email_notifications.is_(True),
            type_filter.is_(True),
            User.email != "",
        )
    )

    result = await db.execute(query)
    return [
        (email, sub.company_name)
        for sub, email in result.all()
        if email
    ]


async def dispatch_alert_emails(
    alerts: Iterable[Any],
    db: AsyncSession,
) -> int:
    """
    For each alert, find subscribed users and send them an email.

    Marks alert.email_sent=True after at least one successful send. Caller
    is responsible for committing the session.

    Returns the count of emails successfully dispatched (across all alerts).
    """
    # PR 3: route through the unified backend (SES → SMTP → log-only).
    # The legacy direct call into ``app.services.aws.ses`` still works
    # because it's the production path inside :func:`send_alert_email`.
    from app.services.email import send_alert_email

    sent_count = 0
    for alert in alerts:
        try:
            recipients = await _find_recipients_for_alert(db, alert)
        except Exception as exc:
            log.warning("Failed to look up recipients for alert %s: %s", alert.id, exc)
            continue

        if not recipients:
            log.debug("No subscribers for alert %s (ticker=%s)", alert.id, alert.ticker)
            continue

        alert_payload = _alert_to_dict(alert)
        any_success = False
        for email, company_name in recipients:
            try:
                msg_id = await send_alert_email(
                    to=email,
                    alert=alert_payload,
                    company_name=company_name,
                )
                if msg_id is not None:
                    sent_count += 1
                    any_success = True
            except Exception as exc:
                log.warning("Email send failed for %s alert=%s: %s", email, alert.id, exc)

        if any_success:
            alert.email_sent = True

    log.info("dispatch_alert_emails: sent %d emails across %d alerts", sent_count, len(list(alerts)) if hasattr(alerts, '__len__') else -1)
    return sent_count


# ── Convenience: end-to-end pipeline hook ─────────────────────────────────────
async def detect_and_notify(
    document_id: str,
    db: AsyncSession,
    *,
    pre_extracted_metrics: dict | None = None,
) -> dict[str, Any]:
    """
    Run anomaly detection AND dispatch email notifications in one call.

    This is the function the document-indexing pipeline should call after a
    document reaches status=INDEXED. Commits at the end.
    """
    from app.services.analytics.anomaly import run_anomaly_detection

    alerts = await run_anomaly_detection(document_id, db, pre_extracted_metrics=pre_extracted_metrics)
    if not alerts:
        await db.commit()
        return {"alerts_created": 0, "emails_sent": 0}

    # Persist alerts before sending emails so we have IDs
    await db.flush()

    emails_sent = await dispatch_alert_emails(alerts, db)
    await db.commit()

    return {"alerts_created": len(alerts), "emails_sent": emails_sent}
