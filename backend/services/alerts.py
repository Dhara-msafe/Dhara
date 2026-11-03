"""Ops Alerts — best-effort operator notification for backend outages.

Currently wired to: eCourts Court Data Engine circuit-breaker open/close
(see services/court_data.py). Designed to be reusable for future ops
signals (AI Gateway all-providers-down, push delivery failures, etc.).

Delivery channels (both optional, both off by default — never crashes the
caller if unconfigured):
  • Email — via the existing Emergent-managed Resend integration (mailer.py).
    Recipient: OPS_ALERT_EMAIL.
  • Slack — via a plain Incoming Webhook POST. URL: OPS_ALERT_SLACK_WEBHOOK_URL.

Both sends are fire-and-forget from the caller's perspective: `send_ops_alert`
never raises. A failure to notify must never take down the subsystem that is
already degraded.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx

logger = logging.getLogger("ops_alerts")

OPS_ALERT_EMAIL = os.getenv("OPS_ALERT_EMAIL", "").strip()
OPS_ALERT_SLACK_WEBHOOK_URL = os.getenv("OPS_ALERT_SLACK_WEBHOOK_URL", "").strip()


def alerts_configured() -> dict:
    return {
        "email": bool(OPS_ALERT_EMAIL),
        "slack": bool(OPS_ALERT_SLACK_WEBHOOK_URL),
        "any": bool(OPS_ALERT_EMAIL or OPS_ALERT_SLACK_WEBHOOK_URL),
    }


async def send_ops_alert(title: str, detail: str, *, severity: str = "warning") -> None:
    """Best-effort fan-out to every configured channel. Never raises.

    `severity` — "warning" | "critical" | "info" — only affects emoji/formatting.
    """
    if not (OPS_ALERT_EMAIL or OPS_ALERT_SLACK_WEBHOOK_URL):
        logger.info("[ops_alerts] no channel configured — skip (%s)", title)
        return

    from services.outbound_guard import outbound_live, record_simulated
    if not outbound_live():
        await record_simulated("ops_alert", "ops", {"title": title, "detail": detail, "severity": severity})
        return

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    icon = {"critical": "🔴", "warning": "🟠", "info": "🔵"}.get(severity, "🟠")

    if OPS_ALERT_SLACK_WEBHOOK_URL:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    OPS_ALERT_SLACK_WEBHOOK_URL,
                    json={"text": f"{icon} *Dhara Ops Alert* — {title}\n{detail}\n_{ts}_"},
                )
        except Exception as e:
            logger.warning("[ops_alerts] slack send failed: %s", e)

    if OPS_ALERT_EMAIL:
        try:
            from mailer import send_email, email_configured
            if email_configured():
                html = (
                    '<table role="presentation" width="100%" style="background:#FDFBF7;padding:24px 0">'
                    '<tr><td align="center">'
                    '<table role="presentation" width="100%" style="max-width:520px;background:#FFFFFF;'
                    'border-radius:12px;padding:28px;font-family:Arial,Helvetica,sans-serif;color:#12203A">'
                    f'<tr><td style="font-size:20px;font-weight:700;padding-bottom:10px">{icon} Dhara Ops Alert</td></tr>'
                    f'<tr><td style="font-size:15px;font-weight:700;padding-bottom:6px">{title}</td></tr>'
                    f'<tr><td style="font-size:14px;line-height:20px;color:#374151;white-space:pre-line">{detail}</td></tr>'
                    f'<tr><td style="font-size:12px;color:#8A93A6;padding-top:16px">{ts}</td></tr>'
                    "</table></td></tr></table>"
                )
                await send_email(to=OPS_ALERT_EMAIL, subject=f"[Dhara Ops] {title}", html=html)
        except Exception as e:
            logger.warning("[ops_alerts] email send failed: %s", e)
