"""
guardian_email.py — A43/A44/A45/A46: reaching a trusted person who does not
have DHARA installed.

Until now a trusted circle member had to be a DHARA user: the invite matched
a phone number against existing accounts, and anyone without an account was
invited into silence — no message, no way to accept, no alert if she missed
a check-in. For a pilot where most guardians are parents, partners and
friends, that is most of them.

Email fills the gap. It needs no app, and unlike SMS to an Indian number it
needs no DLT registration, so it can work today.

What this module owns:
  * the one-time secrets in the links an email carries, stored only as
    hashes, so a leak of the database does not hand anyone a working link;
  * the absolute base URL those links are built on;
  * an optional allow-list for the pilot, so real email can be limited to
    named addresses while it is being tried out.

The email bodies themselves live in mailer.py with every other template.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
from datetime import datetime, timezone

logger = logging.getLogger("dhara.guardian_email")

# A link in an email is a capability: whoever holds it can use it. So the
# token is long, random, and never stored in a form that can be replayed.
TOKEN_BYTES = 32
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$")


def normalise_email(value: str | None) -> str | None:
    """Trimmed and lower-cased, or None when it is not an address at all."""
    if not value:
        return None
    cleaned = value.strip().lower()
    if len(cleaned) > 254 or not _EMAIL_RE.match(cleaned):
        return None
    return cleaned


def new_token() -> tuple[str, str]:
    """(token to put in the email, hash to store). The plain token is never
    written to the database or to a log."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _link_secret() -> str:
    """The key the view link is derived from. Rotating it invalidates every
    link already in someone's inbox, which is the intended emergency stop."""
    return (os.environ.get("GUARDIAN_LINK_SECRET")
            or os.environ.get("JWT_SECRET")
            or "")


def view_token_for(link_id: str) -> str | None:
    """The token in the "see her last known area" link.

    Derived from the link id with a server secret rather than stored, so the
    same address can be rebuilt for every alert email without the plain token
    ever sitting in the database. Only its hash is stored, for the lookup.
    """
    secret = _link_secret()
    if not secret or not link_id:
        return None
    mac = hmac.new(secret.encode("utf-8"), f"view:{link_id}".encode("utf-8"), hashlib.sha256)
    return base64.urlsafe_b64encode(mac.digest()).decode("ascii").rstrip("=")


def public_base_url() -> str | None:
    """Where an emailed link points. Absolute, because an email has no origin.

    Set PUBLIC_BASE_URL in the deployment. Without it, guardian emails are
    not sent at all: a message whose links do not work is worse than none.
    """
    raw = (os.environ.get("PUBLIC_BASE_URL") or "").strip().rstrip("/")
    if not raw:
        return None
    if not raw.startswith("https://"):
        logger.warning("[guardian_email] PUBLIC_BASE_URL must be https — ignoring %r", raw)
        return None
    return raw


def invite_url(token: str) -> str | None:
    base = public_base_url()
    return f"{base}/api/trusted-circle/invitation/email/{token}" if base else None


def guardian_view_url(token: str) -> str | None:
    base = public_base_url()
    return f"{base}/api/guardian/email/{token}" if base else None


def pilot_allowlist() -> frozenset[str]:
    """Addresses allowed to receive real guardian email while the pilot runs.

    Empty (the default) means no restriction: every invited address is
    emailed. Set PILOT_GUARDIAN_EMAILS to a comma-separated list to hold it
    to named testers first.
    """
    raw = os.environ.get("PILOT_GUARDIAN_EMAILS", "")
    found = {normalise_email(p) for p in raw.replace(",", " ").split()}
    return frozenset(e for e in found if e)


def may_email(address: str | None) -> bool:
    """False when the pilot allow-list is in force and this address is not on
    it. The outbound guard still decides whether anything is really sent."""
    allowed = pilot_allowlist()
    if not allowed:
        return True
    return (normalise_email(address) or "") in allowed


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
