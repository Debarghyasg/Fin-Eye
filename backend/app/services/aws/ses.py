"""
AWS SES email service — Phase 3 Week 6 Day 4-5.

Sends transactional emails for anomaly alerts and EDGAR filing notifications.
Falls back to a no-op (info-level log) when USE_SES is disabled, so the rest
of the app works in local/free mode.

Usage:
    from app.services.aws.ses import send_alert_email
    await send_alert_email(to="analyst@example.com", subject="...", html_body="...", text_body="...")
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from app.core.config import settings

log = logging.getLogger(__name__)


def _ses_client() -> Any:
    """Build a boto3 SES client with optional LocalStack endpoint."""
    import boto3

    kwargs: dict[str, Any] = {
        "region_name": settings.AWS_REGION,
        "aws_access_key_id": settings.AWS_ACCESS_KEY_ID,
        "aws_secret_access_key": settings.AWS_SECRET_ACCESS_KEY,
    }
    if settings.AWS_ENDPOINT_URL:
        kwargs["endpoint_url"] = settings.AWS_ENDPOINT_URL
    return boto3.client("ses", **kwargs)


# ── Email sending (sync core, async wrapper) ──────────────────────────────────
def _send_email_sync(
    to_address: str,
    subject: str,
    html_body: str,
    text_body: str,
    from_address: Optional[str] = None,
) -> dict[str, Any]:
    """Send a single email through SES. Returns the SES response dict."""
    client = _ses_client()
    response = client.send_email(
        Source=from_address or settings.SES_FROM_ADDRESS,
        Destination={"ToAddresses": [to_address]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {
                "Html": {"Data": html_body, "Charset": "UTF-8"},
                "Text": {"Data": text_body, "Charset": "UTF-8"},
            },
        },
    )
    return response


async def send_email(
    to: str,
    subject: str,
    html_body: str,
    text_body: str,
    from_address: Optional[str] = None,
) -> Optional[str]:
    """
    Send an email via SES.

    Returns the SES MessageId on success, or None when SES is disabled
    or sending fails. Never raises — this is best-effort notification.
    """
    if not to or "@" not in to:
        log.warning("send_email: invalid recipient %r", to)
        return None

    if not settings.USE_SES:
        log.info(
            "SES disabled — would have sent: to=%r subject=%r (text preview: %s)",
            to, subject, text_body[:120],
        )
        return None

    if not settings.SES_FROM_ADDRESS and not from_address:
        log.error("send_email: SES_FROM_ADDRESS not configured")
        return None

    try:
        response = await asyncio.to_thread(
            _send_email_sync, to, subject, html_body, text_body, from_address,
        )
        msg_id = response.get("MessageId")
        log.info("SES email sent: to=%s subject=%r MessageId=%s", to, subject, msg_id)
        return msg_id
    except Exception as exc:
        log.error("SES send failed (to=%s subject=%r): %s", to, subject, exc)
        return None


# ── Alert email rendering ─────────────────────────────────────────────────────
_SEVERITY_COLORS = {
    "high": "#ef4444",
    "medium": "#f59e0b",
    "low": "#22a269",
    "info": "#94a3b8",
}


def render_alert_email(
    alert: dict[str, Any],
    *,
    company_name: Optional[str] = None,
    app_url: Optional[str] = None,
) -> tuple[str, str, str]:
    """
    Render subject + html body + text body for an alert.

    `alert` is a dict (or ORM-as-dict) with: title, description, severity,
    ticker, alert_type, metric_name, metric_value, z_score, created_at.
    """
    severity = alert.get("severity", "info")
    title = alert.get("title", "FinSight Alert")
    description = alert.get("description", "")
    ticker = alert.get("ticker") or "—"
    alert_type = alert.get("alert_type", "anomaly")

    color = _SEVERITY_COLORS.get(severity, "#94a3b8")
    company_label = company_name or ticker
    base_url = app_url or settings.APP_URL or "http://localhost:3000"
    alerts_link = f"{base_url.rstrip('/')}/alerts"

    subject = f"[FinSight {severity.upper()}] {title}"

    # Stats footer (only meaningful for anomaly alerts)
    stats_lines: list[str] = []
    if alert.get("metric_name") and alert.get("metric_value") is not None:
        stats_lines.append(f"Metric: {alert['metric_name']}")
        stats_lines.append(f"Value:  {alert['metric_value']:,.2f}")
    if alert.get("z_score") is not None:
        stats_lines.append(f"Z-score: {alert['z_score']:.2f}σ")
    if alert.get("historical_mean") is not None:
        stats_lines.append(f"Historical mean: {alert['historical_mean']:,.2f}")
    if alert.get("sample_size"):
        stats_lines.append(f"Sample size: {alert['sample_size']} prior periods")

    text_body = (
        f"FinSight {severity.upper()} alert for {company_label} ({ticker})\n\n"
        f"{title}\n\n"
        f"{description}\n\n"
        + ("\n".join(stats_lines) + "\n\n" if stats_lines else "")
        + f"Type: {alert_type}\n"
        f"View in dashboard: {alerts_link}\n"
    )

    stats_html = ""
    if stats_lines:
        rows = "".join(
            f"<tr><td style='padding:4px 12px 4px 0;color:#64748b;font-size:12px'>{line}</td></tr>"
            for line in stats_lines
        )
        stats_html = (
            f"<table style='margin-top:16px;border-top:1px solid #e2e8f0;padding-top:12px'>{rows}</table>"
        )

    html_body = f"""<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:24px">
  <table cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <tr><td style="background:{color};color:#fff;padding:16px 24px;font-weight:600;font-size:14px;letter-spacing:0.5px;text-transform:uppercase">
      {severity} • {alert_type}
    </td></tr>
    <tr><td style="padding:24px">
      <div style="font-size:11px;color:#64748b;margin-bottom:4px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">{company_label} • {ticker}</div>
      <h1 style="font-size:18px;margin:0 0 12px 0;color:#0f172a">{title}</h1>
      <p style="font-size:14px;line-height:1.6;color:#334155;margin:0">{description}</p>
      {stats_html}
      <a href="{alerts_link}" style="display:inline-block;margin-top:20px;padding:8px 16px;background:#22a269;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:500">View in Dashboard →</a>
    </td></tr>
    <tr><td style="padding:12px 24px;background:#f8fafc;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0">
      You're receiving this because you subscribed to {ticker} on FinSight AI.
    </td></tr>
  </table>
</body></html>"""

    return subject, html_body, text_body


async def send_alert_email(
    *,
    to: str,
    alert: dict[str, Any],
    company_name: Optional[str] = None,
    app_url: Optional[str] = None,
) -> Optional[str]:
    """High-level helper: render + send an alert email in one call."""
    subject, html_body, text_body = render_alert_email(
        alert, company_name=company_name, app_url=app_url,
    )
    return await send_email(to=to, subject=subject, html_body=html_body, text_body=text_body)
