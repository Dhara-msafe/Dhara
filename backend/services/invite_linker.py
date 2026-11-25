"""
invite_linker.py — shared helper for linking pending Trusted Circle invitations
to a newly-registered or profile-updated user.

Called from:
  • api/auth_router.py  (register, google_auth_session)
  • api/profile_router.py (PATCH /profile/me when phone or email changes)

Privacy note: we never store the plain invite token; only its hash is in the
database.  Matching works on the last-10-digits of the contact_phone or
case-insensitive contact_email — both already normalised when the invite was
created.
"""
from __future__ import annotations

import re
import logging

logger = logging.getLogger("dhara.invite_linker")

try:
    from push import send_push
except Exception:  # pragma: no cover — push relay optional in some envs
    async def send_push(*a, **kw):  # type: ignore
        return None


def _norm_phone(p: str) -> str:
    digits = re.sub(r"\D", "", p or "")
    return digits[-10:] if len(digits) >= 10 else digits


async def link_pending_invites(db, user_id: str, phone: str, email: str) -> int:
    """Find every pending trusted_circle_links whose contact_phone (last-10)
    or contact_email (case-insensitive) matches phone/email, set their
    invitee_user_id to user_id, and fire a push.

    Returns the number of links that were linked.
    """
    norm_p = _norm_phone(phone or "")
    norm_e = (email or "").lower().strip()
    linked = 0

    async for link in db.trusted_circle_links.find(
        {"status": "pending", "invitee_user_id": None}
    ):
        # Skip own links
        if link.get("owner_id") == user_id:
            continue
        matched = False
        if norm_p and _norm_phone(link.get("contact_phone", "")) == norm_p:
            matched = True
        if not matched and norm_e and (link.get("contact_email") or "").lower().strip() == norm_e:
            matched = True
        if not matched:
            continue

        await db.trusted_circle_links.update_one(
            {"id": link["id"]},
            {"$set": {"invitee_user_id": user_id}},
        )
        linked += 1
        logger.info(
            "[invite_linker] linked invite %s to user %s (phone_match=%s email_match=%s)",
            link["id"], user_id,
            norm_p and _norm_phone(link.get("contact_phone", "")) == norm_p,
            norm_e and (link.get("contact_email") or "").lower().strip() == norm_e,
        )

        try:
            await send_push(
                recipients=[user_id],
                data={
                    "title": "Trusted Circle invitation",
                    "message": (
                        f"{link.get('owner_name', 'Someone')} wants to add you "
                        "to their Trusted Circle"
                    ),
                    "action_url": f"/invite/{link['id']}",
                },
                idempotency_key=f"tc_invite_link:{link['id']}",
            )
        except Exception as exc:  # pragma: no cover
            logger.warning(
                "[invite_linker] push failed for invite %s: %s", link["id"], exc
            )

    return linked
