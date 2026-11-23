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


async def send_email(*, to: str, subject: str, html: str, channel: str | None = None) -> str | None:
    """Internal helper. `html` always comes from a template in this module.

    `channel` says which outbound policy governs this message. Account mail
    (reset, deletion) keeps the reset channel; a guardian alert passes EMAIL,
    so the two can be switched on and off separately.
    """
    if not email_configured():
        raise HTTPException(503, "Email is not configured on this server.")
    _assert_safe_email(subject, html)
    from services.outbound_guard import record_simulated, should_send, RESET_EMAIL
    if not should_send(channel or RESET_EMAIL):
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


def upi_status_email(*, name: str, status: str, message: str) -> tuple[str, str]:
    """B-124: (subject, html) telling the person the result of their UPI
    payment check. Fixed template; `message` is fixed server text."""
    subject = {
        "confirmed": "Your Dhara Pro payment is confirmed",
        "rejected": "We could not confirm your Dhara Pro payment",
    }.get(status, "Update on your Dhara Pro payment")
    inner = (
        '<tr><td style="font-size:22px;font-weight:700;padding-bottom:8px">Dhara</td></tr>'
        f'<tr><td style="font-size:15px;line-height:22px">Hi {escape(name or "there")},</td></tr>'
        f'<tr><td style="font-size:15px;line-height:22px;padding-top:12px">{escape(message)}</td></tr>'
        '<tr><td style="font-size:14px;line-height:21px;color:#4A5568;padding-top:12px">'
        "Open the Dhara app to see your account.</td></tr>"
    )
    return subject, _shell(inner)


# ── A43/A45: email to a trusted person who does not have DHARA ───────────────
#
# These go to someone who did not sign up: they were named by a DHARA user as
# someone she trusts. So each one says who added them, what it would mean,
# and how to refuse — in the first line, not the small print.


def guardian_invite_email(*, owner_name: str, contact_name: str,
                          accept_url: str, decline_url: str,
                          shares_location: bool) -> tuple[str, str]:
    """Invitation to be someone's trusted contact, with no app needed."""
    subject = f"{owner_name} has asked you to be their safety contact on Dhara"
    shared = (
        "the area she is in while a journey is running, and the time she expects to arrive"
        if shares_location else
        "when she starts a journey and whether she arrives safely"
    )
    inner = (
        '<tr><td style="font-size:22px;font-weight:700;padding-bottom:8px">Dhara</td></tr>'
        f'<tr><td style="font-size:15px;line-height:22px">Hi {escape(contact_name or "there")}, '
        f"<b>{escape(owner_name)}</b> uses Dhara, an app that watches over her when she "
        "travels. She has asked for you to be told if she does not arrive safely.</td></tr>"
        '<tr><td style="font-size:15px;line-height:22px;padding-top:14px">'
        f"If you agree, you would be sent an email when she starts a journey and if she "
        f"misses her check-in. You would see {escape(shared)}. Nothing else, and only while "
        "a journey is running.</td></tr>"
        '<tr><td align="center" style="padding:22px 0 6px">'
        f'<a href="{escape(accept_url)}" style="background:#12203A;color:#FFFFFF;'
        'text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;'
        'padding:14px 28px;display:inline-block">Yes, I will be her contact</a></td></tr>'
        '<tr><td align="center" style="padding-bottom:18px">'
        f'<a href="{escape(decline_url)}" style="color:#4A5568;font-size:14px">'
        "No, do not contact me</a></td></tr>"
        '<tr><td style="font-size:14px;line-height:21px;color:#4A5568">'
        "You do not need the app, and you do not need an account. If you do nothing, "
        "you will not be contacted again about this.</td></tr>"
    )
    return subject, _shell(inner)


def guardian_journey_started_email(*, owner_name: str, contact_name: str,
                                   destination: str, expected_time: str,
                                   view_url: str | None) -> tuple[str, str]:
    subject = f"{owner_name} has started a journey"
    link = (
        '<tr><td align="center" style="padding:18px 0">'
        f'<a href="{escape(view_url)}" style="background:#12203A;color:#FFFFFF;'
        'text-decoration:none;font-size:15px;font-weight:700;border-radius:10px;'
        'padding:12px 24px;display:inline-block">See where she is</a></td></tr>'
    ) if view_url else ""
    inner = (
        '<tr><td style="font-size:22px;font-weight:700;padding-bottom:8px">Dhara</td></tr>'
        f'<tr><td style="font-size:15px;line-height:22px">Hi {escape(contact_name or "there")}, '
        f"<b>{escape(owner_name)}</b> has started a journey to {escape(destination)} and "
        f"expects to arrive by {escape(expected_time)}.</td></tr>"
        f"{link}"
        '<tr><td style="font-size:14px;line-height:21px;color:#4A5568">'
        "You do not need to do anything now. If she does not check in on time, "
        "we will email you again.</td></tr>"
    )
    return subject, _shell(inner)


def guardian_missed_checkin_email(*, owner_name: str, contact_name: str,
                                  expected_time: str, last_area: str | None,
                                  last_seen_mins: int | None,
                                  view_url: str | None) -> tuple[str, str]:
    """The one that matters. Plain words, no jargon, what to do first."""
    subject = f"{owner_name} has not checked in on Dhara"
    if last_area:
        ago = f"about {last_seen_mins} minutes ago" if last_seen_mins is not None else "earlier"
        where = (
            '<tr><td style="font-size:15px;line-height:22px;padding-top:12px">'
            f"She was last in <b>{escape(last_area)}</b>, {escape(ago)}.</td></tr>"
        )
    else:
        where = (
            '<tr><td style="font-size:15px;line-height:22px;padding-top:12px">'
            "Dhara has no recent location for her.</td></tr>"
        )
    link = (
        '<tr><td align="center" style="padding:18px 0">'
        f'<a href="{escape(view_url)}" style="background:#B3261E;color:#FFFFFF;'
        'text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;'
        'padding:14px 28px;display:inline-block">See her last known area</a></td></tr>'
    ) if view_url else ""
    inner = (
        '<tr><td style="font-size:22px;font-weight:700;padding-bottom:8px">Dhara</td></tr>'
        f'<tr><td style="font-size:16px;line-height:23px"><b>{escape(owner_name)}</b> set a '
        f"check-in time of {escape(expected_time)} and has not confirmed that she arrived."
        "</td></tr>"
        f"{where}"
        '<tr><td style="font-size:15px;line-height:22px;padding-top:12px">'
        "Please try to contact her now. If you cannot reach her and you are worried, "
        "call the police on 112.</td></tr>"
        f"{link}"
        '<tr><td style="font-size:14px;line-height:21px;color:#4A5568">'
        "This may be nothing — people forget to check in. Dhara cannot tell whether she "
        "is safe, only that she has not said so.</td></tr>"
    )
    return subject, _shell(inner)


def guardian_journey_safe_email(*, owner_name: str, contact_name: str) -> tuple[str, str]:
    subject = f"{owner_name} has arrived safely"
    inner = (
        '<tr><td style="font-size:22px;font-weight:700;padding-bottom:8px">Dhara</td></tr>'
        f'<tr><td style="font-size:15px;line-height:22px">Hi {escape(contact_name or "there")}, '
        f"<b>{escape(owner_name)}</b> has marked herself safe. Her journey is over and her "
        "location is no longer being shared.</td></tr>"
    )
    return subject, _shell(inner)
