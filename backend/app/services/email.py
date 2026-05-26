"""
Unified email dispatcher (PR 3) — SES / SMTP / log-only fallback chain.

Replaces direct ``app.services.aws.ses.send_email`` calls with a single
entry point that picks the right backend at call time:

  1. ``settings.USE_SES=true``        → AWS SES via boto3 (production)
  2. ``settings.SMTP_HOST`` is set    → stdlib smtplib (Mailhog in dev,
                                         Gmail/Office365/SES-SMTP in prod)
  3. neither                          → structured log line only, no send

Why a wrapper instead of just calling SES directly?
---------------------------------------------------
The PDF spec (§4 Local Dev → AWS Production table) wants Mailhog as the
local-dev email capture and SES in production. Callers shouldn't care.
This module makes the swap one config flag — exactly the same shape as
``storage.py`` (local FS vs S3) and ``rag/qdrant_store.py`` (Qdrant vs
Pinecone).

The function is async-first so the existing ``alerts.py`` call sites stay
the same. Synchronous SMTP I/O is shoved off to a thread.

Never raises — best-effort notification by design.
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from app.core.config import settings

log = logging.getLogger(__name__)


def _from_address(override: Optional[str]) -> str:
    """Resolve the From: address — explicit override > EMAIL_FROM > SES_FROM."""
    return override or settings.EMAIL_FROM_ADDRESS or settings.SES_FROM_ADDRESS or "alerts@finsight.local"


# ── Backend: stdlib SMTP (Mailhog dev, generic SMTP prod) ─────────────────────
def _send_smtp_sync(
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    use_tls: bool,
    from_address: str,
    to_address: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> None:
    """Build a multipart message and ship it via smtplib.

    Mailhog is auth-less, so when ``username`` is blank we skip the login
    handshake entirely. Real SMTP servers (Gmail, Office365, SES SMTP) want
    STARTTLS + login, gated by ``use_tls``.
    """
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_address
    msg["To"] = to_address
    # Order matters — clients render the *last* part they understand.
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP(host, port, timeout=15) as server:
        if use_tls:
            server.starttls()
        if username:
            server.login(username, password)
        server.send_message(msg)


# ── Public API ────────────────────────────────────────────────────────────────
async def send_email(
    to: str,
    subject: str,
    html_body: str,
    text_body: str,
    from_address: Optional[str] = None,
) -> Optional[str]:
    """Send an email through whichever backend is configured.

    Returns a non-None value on success (SES MessageId or the constant
    ``"smtp"``), and None when the email was dropped (validation failed,
    backend disabled, or send raised).
    """
    if not to or "@" not in to:
        log.warning("send_email: invalid recipient %r", to)
        return None

    sender = _from_address(from_address)

    # 1. SES — production path
    if settings.USE_SES:
        from app.services.aws.ses import send_email as _ses_send

        return await _ses_send(
            to=to,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            from_address=sender,
        )

    # 2. SMTP — dev path (Mailhog) or non-SES production SMTP
    if settings.SMTP_HOST:
        try:
            await asyncio.to_thread(
                _send_smtp_sync,
                host=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                username=settings.SMTP_USERNAME,
                password=settings.SMTP_PASSWORD,
                use_tls=settings.SMTP_USE_TLS,
                from_address=sender,
                to_address=to,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
            )
            log.info(
                "SMTP email sent: backend=%s:%d to=%s subject=%r",
                settings.SMTP_HOST, settings.SMTP_PORT, to, subject,
            )
            return "smtp"
        except Exception as exc:
            log.error(
                "SMTP send failed (host=%s:%d to=%s subject=%r): %s",
                settings.SMTP_HOST, settings.SMTP_PORT, to, subject, exc,
            )
            return None

    # 3. Log-only — neither backend configured
    log.info(
        "Email backend disabled (USE_SES=false, SMTP_HOST=''). Would have sent: "
        "to=%s subject=%r preview=%r",
        to, subject, text_body[:120],
    )
    return None


async def send_alert_email(
    *,
    to: str,
    alert: dict,
    company_name: Optional[str] = None,
    app_url: Optional[str] = None,
) -> Optional[str]:
    """Render an alert template and dispatch it via :func:`send_email`."""
    # The render helper already lives in services.aws.ses for historical
    # reasons. Re-using it keeps the email markup in one place.
    from app.services.aws.ses import render_alert_email

    subject, html_body, text_body = render_alert_email(
        alert, company_name=company_name, app_url=app_url,
    )
    return await send_email(
        to=to, subject=subject, html_body=html_body, text_body=text_body,
    )
