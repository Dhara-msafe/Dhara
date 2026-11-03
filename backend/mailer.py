"""
Transactional email via the Emergent-managed Resend integration.

Used for the password-reset OTP and the account-deletion OTP. Recipients
always come from a server-side DB lookup and bodies always come from the
fixed templates in this file — no caller ever supplies a recipient, subject
or HTML.
"""
import os
import re
import ipaddress
import logging
import httpx
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()
logger = logging.getLogger("dhara.mailer")

# Emergent managed email proxy. CONSTANT — never read from os.environ so it
# survives deployment.
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


def email_configured() -> bool:
    return bool(EMAIL_KEY and EMAIL_FROM_NAME)


async def send_email(*, to: str, subject: str, html: str) -> str | None:
    """Internal helper. `html` always comes from a template in this module."""
    if not email_configured():
        raise HTTPException(503, "Email is not configured on this server.")
    _assert_safe_email(subject, html)
    from services.outbound_guard import record_simulated, should_send, RESET_EMAIL
    if not should_send(RESET_EMAIL):
        # QA / closed-testing-not-live: the message is kept only in this DB's
        # qa_outbox (isolated QA inbox) — nothing is sent.
        return await record_simulated("email", to, {"subject": subject, "html": html})
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(502, "Could not send the email. Please try again.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Email send error: {e}")
        raise HTTPException(502, "Could not send the email. Please try again.")


def _shell(inner: str) -> str:
    return (
        '<table role="presentation" width="100%" style="background:#FDFBF7;padding:24px 0">'
        '<tr><td align="center">'
        '<table role="presentation" width="100%" style="max-width:520px;background:#FFFFFF;'
        'border-radius:12px;padding:28px;font-family:Arial,Helvetica,sans-serif;color:#12203A">'
        f"{inner}"
        '<tr><td style="padding-top:20px;font-size:12px;color:#8A93A6;line-height:18px">'
        f"Sent by {escape(EMAIL_FROM_NAME or 'Dhara')}. We never ask for your password, "
        "card details or this code by email, phone or WhatsApp. If you did not request "
        "this, you can ignore this message.<br><br>"
        "&copy; Callistus Moses &middot; MSafe Solutions"
        "</td></tr>"
        "</table></td></tr></table>"
    )


def password_reset_otp_email(*, name: str, code: str, minutes: int) -> tuple[str, str]:
    """Returns (subject, html) for the password-reset OTP. Fixed template."""
    subject = "Your Dhara password reset code"
    inner = (
        '<tr><td style="font-size:22px;font-weight:700;padding-bottom:8px">Dhara</td></tr>'
        f'<tr><td style="font-size:15px;line-height:22px">Hi {escape(name or "there")}, '
        "here is the code to reset your Dhara password.</td></tr>"
        '<tr><td align="center" style="padding:24px 0">'
        '<div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#12203A;'
        'background:#F3EFE7;border-radius:10px;padding:16px 8px">'
        f"{escape(code)}</div></td></tr>"
            f'<tr><td style="font-size:14px;line-height:21px;color:#4A5568">This code expires in '
        f"{minutes} minutes and can be used once. Type it into the app to choose a new "
        "password.</td></tr>"
    )
    return subject, _shell(inner)


def account_deletion_otp_email(*, name: str, code: str, minutes: int) -> tuple[str, str]:
    """Returns (subject, html) for the account-deletion OTP. Fixed template."""
    subject = "Confirm deletion of your Dhara account"
    inner = (
        '<tr><td style="font-size:22px;font-weight:700;padding-bottom:8px">Dhara</td></tr>'
        f'<tr><td style="font-size:15px;line-height:22px">Hi {escape(name or "there")}, '
        "use this code to permanently delete your Dhara account and all its data.</td></tr>"
        '<tr><td align="center" style="padding:24px 0">'
        '<div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#12203A;'
        'background:#F3EFE7;border-radius:10px;padding:16px 8px">'
        f"{escape(code)}</div></td></tr>"
        f'<tr><td style="font-size:14px;line-height:21px;color:#4A5568">This code expires in '
        f"{minutes} minutes and can be used once. If you did not request this, ignore this "
        "email — your account will not be deleted without it.</td></tr>"
    )
    return subject, _shell(inner)
