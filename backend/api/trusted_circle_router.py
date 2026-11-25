"""Trusted Circle — recipient linking & invitations (Part B/P3).

This is a NEW, additive layer. It does NOT touch or replace the existing
local-device Trusted Circle contact list (src/women/api.ts getCircle/
saveCircle, AsyncStorage-only) — that remains exactly as-is for simple
SMS-based sharing. This router only governs the optional, explicit
in-app linking of a contact who is ALSO a registered DHARA account, so
they can receive authorized Safety Alerts in their own app.

Uses its own invitation id + accept/decline flow — intentionally separate
from journey_router.py's anonymous guardian share token (per spec: do not
introduce a conflicting token design).

Collection: trusted_circle_links
  id, owner_id, owner_name, contact_name, contact_phone,
  invitee_user_id (resolved by phone match, may be None if not yet a user),
  permissions: {journey_status, expected_arrival, missed_checkin, temp_location, emergency_requests} (all bool),
  status: pending | accepted | declined | revoked | left
  muted: bool
  created_at, responded_at

B-CONSENT-GUARD (v2.2.1) — TRANSACTIONAL PATH / PURPOSES.UPDATES EXEMPTION
-----------------------------------------------------------------------------
Push notifications sent from this router (invitation, acceptance, decline) are
transactional safety messages the user expects as a direct result of their own
action.  They are NOT proactive marketing or legal-awareness messages.

DO NOT add an is_awareness_updates_consented() check here.  Any future
proactive awareness SMS path (legal tips, bulletins) MUST call
outbound_guard.is_awareness_updates_consented(user) before dispatching.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Form
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from html import escape

from dependencies import db, current_user, logger
from services import guardian_email as ge

try:
    from push import send_push
except Exception:   # pragma: no cover — push relay optional in some envs
    async def send_push(*a, **kw):  # type: ignore
        return None

router = APIRouter()


class PermissionsIn(BaseModel):
    journey_status: bool = True
    expected_arrival: bool = True
    missed_checkin: bool = True
    temp_location: bool = False
    emergency_requests: bool = True


class InviteIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    phone: str = Field(..., min_length=6, max_length=20)
    # A43: how to reach a trusted person who does not have DHARA. Optional,
    # because an invitation to an existing user still works by phone alone.
    email: Optional[str] = Field(default=None, max_length=254)
    permissions: PermissionsIn = PermissionsIn()
    relationship: Optional[str] = Field(default=None, max_length=30)


class RespondIn(BaseModel):
    action: str   # "accept" | "decline"


class MuteIn(BaseModel):
    muted: bool


class PermissionsPatchIn(BaseModel):
    """Partial update — every field optional. Only keys explicitly present in
    the request body are changed; omitted keys keep their current stored
    value. Mirrors the Partial<Permissions> contract inviteContact() already
    uses client-side at invite time."""
    journey_status: Optional[bool] = None
    expected_arrival: Optional[bool] = None
    missed_checkin: Optional[bool] = None
    temp_location: Optional[bool] = None
    emergency_requests: Optional[bool] = None


def _normalize_phone(p: str) -> str:
    digits = re.sub(r"\D", "", p or "")
    return digits[-10:] if len(digits) >= 10 else digits


def _public_link(link: dict) -> dict:
    return {
        "id": link["id"],
        "owner_id": link["owner_id"],
        "owner_name": link.get("owner_name"),
        "contact_name": link.get("contact_name"),
        "contact_phone": link.get("contact_phone"),
        "relationship": link.get("relationship"),
        "invitee_user_id": link.get("invitee_user_id"),
        "permissions": link.get("permissions", {}),
        "status": link["status"],
        "muted": bool(link.get("muted", False)),
        # A49: can anything actually reach this person? An accepted contact
        # with no app and no address is a false sense of safety, so say so
        # rather than letting her assume he will be told.
        "reachable": bool(
            link.get("invitee_user_id") or link.get("contact_email")
        ) and not link.get("muted", False),
        "created_at": link["created_at"],
        "responded_at": link.get("responded_at"),
    }


# ── A43/A44: invitation by email, acceptance without the app ────────────────

def _page(title: str, body_html: str, tone: str = "#12203A") -> HTMLResponse:
    """A small self-contained page for someone who has no app and may be on
    any phone. No scripts, no tracking, no third-party anything."""
    html = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<meta name=\"robots\" content=\"noindex,nofollow\">"
        f"<title>{escape(title)} · Dhara</title>"
        "<style>body{margin:0;background:#FDFBF7;font-family:system-ui,-apple-system,"
        "Segoe UI,Roboto,Arial,sans-serif;color:#12203A}main{max-width:520px;margin:0 auto;"
        "padding:28px 20px}.card{background:#fff;border-radius:14px;padding:24px;"
        "box-shadow:0 1px 3px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 12px}"
        "p{font-size:16px;line-height:24px;margin:0 0 14px}.muted{color:#4A5568;font-size:14px;"
        "line-height:21px}.btn{display:block;text-align:center;text-decoration:none;color:#fff;"
        "background:#12203A;border:0;border-radius:10px;padding:14px;font-size:16px;"
        "font-weight:700;width:100%;margin:8px 0;cursor:pointer}.btn.ghost{background:#fff;"
        "color:#4A5568;border:1px solid #D7D2C8}.area{font-size:22px;font-weight:700;"
        "margin:6px 0}</style></head><body><main><div class=\"card\">"
        f"<h1 style=\"color:{tone}\">{escape(title)}</h1>{body_html}</div>"
        "<p class=\"muted\" style=\"padding:16px 4px\">Dhara · MSafe Solutions. "
        "This page was opened from a link in an email. It asks for no password and "
        "no payment.</p></main></body></html>"
    )
    return HTMLResponse(html, headers={"X-Robots-Tag": "noindex, nofollow",
                                       "Cache-Control": "no-store"})


async def _send_invite_email(link: dict, invite_token: str) -> bool:
    """Send the invitation. Returns whether it actually went out."""
    address = link.get("contact_email")
    accept_url = ge.invite_url(invite_token)
    if not accept_url:
        logger.warning("[trusted_circle] PUBLIC_BASE_URL is not set — invitation email not sent")
        return False
    if not ge.may_email(address):
        logger.info("[trusted_circle] address not on the pilot allow-list — invitation not sent")
        return False
    try:
        from mailer import guardian_invite_email, send_email, email_configured
        from services.outbound_guard import EMAIL
        if not email_configured():
            logger.warning("[trusted_circle] email is not configured — invitation not sent")
            return False
        subject, html = guardian_invite_email(
            owner_name=link.get("owner_name") or "A DHARA user",
            contact_name=link.get("contact_name") or "",
            accept_url=f"{accept_url}?r=accept",
            decline_url=f"{accept_url}?r=decline",
            shares_location=bool((link.get("permissions") or {}).get("temp_location")),
        )
        await send_email(to=address, subject=subject, html=html, channel=EMAIL)
        return True
    except Exception as e:
        logger.warning("[trusted_circle] invitation email failed: %s", e)
        return False


async def _link_by_invite_token(token: str) -> Optional[dict]:
    return await db.trusted_circle_links.find_one({"invite_token_hash": ge.hash_token(token)})


@router.get("/trusted-circle/invitation/email/{token}", response_class=HTMLResponse,
            include_in_schema=False)
async def email_invitation_page(token: str, r: Optional[str] = None):
    """A44: the page the invitation email links to. No app, no account.

    Deliberately identical for an unknown, used or withdrawn token: a page
    that said "no such invitation" would confirm to a stranger which links
    are real.
    """
    link = await _link_by_invite_token(token)
    if not link or link.get("status") in ("revoked", "left"):
        return _page(
            "This invitation is no longer open",
            "<p>The link may have been used already, or the person who sent it may have "
            "changed their mind.</p><p class=\"muted\">Nothing has been shared with you, "
            "and you do not need to do anything.</p>",
        )

    owner = escape(link.get("owner_name") or "A DHARA user")
    shares = bool((link.get("permissions") or {}).get("temp_location"))

    if link.get("status") == "accepted":
        if link.get("contact_email"):
            body = (
                f"<p>You agreed to be {owner}&rsquo;s safety contact. We will email you at "
                f"<b>{escape(link['contact_email'])}</b> when she starts a journey and if she "
                "misses her check-in.</p>"
                f"<form method=\"post\" action=\"respond\"><input type=\"hidden\" name=\"token\" "
                f"value=\"{escape(token)}\"><button class=\"btn ghost\" name=\"action\" "
                "value=\"decline\">Stop contacting me</button></form>"
            )
        else:
            # A49: he accepted without leaving an address, so nothing can
            # reach him. Say so plainly and offer to fix it in one step.
            body = (
                f"<p>You agreed to be {owner}&rsquo;s safety contact, but we have no way to "
                "reach you, so <b>you will not be told if she misses a check-in</b>.</p>"
                f"<form method=\"post\" action=\"respond\">"
                f"<input type=\"hidden\" name=\"token\" value=\"{escape(token)}\">"
                '<label for="email" style="display:block;font-size:15px;margin:6px 0 6px">'
                "Your email address</label>"
                '<input id="email" name="email" type="email" inputmode="email" '
                'autocomplete="email" placeholder="you@example.com" style="width:100%;'
                'box-sizing:border-box;font-size:16px;padding:13px 12px;border:1px solid #D7D2C8;'
                'border-radius:10px;background:#fff">'
                '<button class="btn" name="action" value="accept">Save it</button>'
                '<button class="btn ghost" name="action" value="decline">Stop contacting me</button>'
                "</form>"
            )
        return _page("You are her safety contact", body)

    if link.get("status") == "declined":
        return _page(
            "You have said no to this",
            "<p>You will not be contacted about this again.</p>",
        )

    seeing = (
        "the area she is in while a journey is running, and when she expects to arrive"
        if shares else
        "when she starts a journey and whether she arrives safely"
    )
    # A49: if she did not have his address, ask him for it here. This is the
    # only moment we can: after this page there is no way to reach him at
    # all. His own address, typed by him, is also better than one she
    # guessed — and it is his consent, not hers.
    ask_email = "" if link.get("contact_email") else (
        '<label for="email" style="display:block;font-size:15px;margin:18px 0 6px">'
        "Your email address, so we can tell you</label>"
        '<input id="email" name="email" type="email" inputmode="email" autocomplete="email" '
        'placeholder="you@example.com" style="width:100%;box-sizing:border-box;font-size:16px;'
        'padding:13px 12px;border:1px solid #D7D2C8;border-radius:10px;background:#fff">'
        '<p class="muted" style="margin-top:8px">Without it we cannot tell you anything. '
        "You could still open this link yourself to check on her, but nothing would reach "
        "you when it matters.</p>"
    )
    pre = ""
    if r in ("accept", "decline"):
        pre = ("<p class=\"muted\">Confirm your answer below — one tap, so a link opened "
               "by accident cannot answer for you.</p>")
    return _page(
        f"{owner} has asked you to be her safety contact",
        f"<p>Dhara is an app that watches over her when she travels. If you agree, you "
        f"will be emailed when she starts a journey and if she does not check in on time. "
        f"You would see {escape(seeing)}.</p>"
        "<p>You do not need the app, an account or a password.</p>"
        f"{pre}"
        f"<form method=\"post\" action=\"respond\">"
        f"<input type=\"hidden\" name=\"token\" value=\"{escape(token)}\">"
        f"{ask_email}"
        "<button class=\"btn\" name=\"action\" value=\"accept\">Yes, I will be her contact</button>"
        "<button class=\"btn ghost\" name=\"action\" value=\"decline\">No, do not contact me</button>"
        "</form>"
        "<p class=\"muted\">You can stop at any time by using the link in any email we send "
        "you.</p>",
    )


@router.post("/trusted-circle/invitation/email/respond", response_class=HTMLResponse,
             include_in_schema=False)
async def email_invitation_respond(token: str = Form(...), action: str = Form(...),
                                   email: Optional[str] = Form(default=None)):
    """A44: her trusted person accepts or declines, from the email, with no
    account. The answer is a POST, so opening the link cannot answer for them
    and no mail scanner can accept on their behalf."""
    link = await _link_by_invite_token(token)
    if not link or link.get("status") in ("revoked", "left"):
        return _page("This invitation is no longer open",
                     "<p>Nothing has been shared with you.</p>")

    now = ge.utc_now_iso()
    if action == "accept":
        # A49: his own address, typed by him. Without one there is no channel
        # to him at all — he is accepted but unreachable, and both he and she
        # have to be told that plainly.
        typed = email if isinstance(email, str) else None
        given = ge.normalise_email(typed) or ge.normalise_email(link.get("contact_email"))
        update = {"status": "accepted", "responded_at": now, "email_consent_at": now}
        if given:
            update.update({"contact_email": given, "channel": "email", "reachable": True})
        else:
            update["reachable"] = False
        await db.trusted_circle_links.update_one({"id": link["id"]}, {"$set": update})
        logger.info("[trusted_circle] an invitation was accepted (reachable=%s)", bool(given))

        if given:
            # A confirmation now also proves the address works, while there is
            # still time to correct it — rather than finding out on the night
            # it matters.
            try:
                from mailer import guardian_accepted_email, send_email, email_configured
                from services.outbound_guard import EMAIL
                if email_configured() and ge.may_email(given):
                    subject, html = guardian_accepted_email(
                        owner_name=link.get("owner_name") or "She",
                        contact_name=link.get("contact_name") or "",
                    )
                    await send_email(to=given, subject=subject, html=html, channel=EMAIL)
            except Exception as e:
                logger.warning("[trusted_circle] confirmation email failed: %s", e)
            return _page(
                "Thank you — you are now her safety contact",
                f"<p>{escape(link.get('owner_name') or 'She')} will be told that you agreed.</p>"
                f"<p>We will email you at <b>{escape(given)}</b> when she starts a journey, and "
                "again if she does not check in on time. Nothing else.</p>"
                "<p class=\"muted\">We have just sent you a note to confirm the address works. "
                "If it does not arrive, open this link again and correct it. Every email we "
                "send has a link to stop.</p>",
            )

        return _page(
            "You are her safety contact — but nothing can reach you",
            f"<p>{escape(link.get('owner_name') or 'She')} will be told that you agreed.</p>"
            "<p><b>Because you did not leave an email address, we cannot tell you when she "
            "starts a journey or if she misses a check-in.</b> Keep this link and open it "
            "when you want to check on her.</p>"
            "<p class=\"muted\">Open this link again at any time to add an address.</p>",
        )

    await db.trusted_circle_links.update_one(
        {"id": link["id"]},
        {"$set": {"status": "declined", "responded_at": now},
         "$unset": {"view_token_hash": "", "invite_token_hash": ""}},
    )
    logger.info("[trusted_circle] an email invitation was declined")
    return _page(
        "Done — you will not be contacted",
        "<p>We have removed you from her safety contacts. She is told that you declined, "
        "but not why.</p><p class=\"muted\">Your address is kept only so that the same "
        "invitation cannot be sent to you again.</p>",
    )


@router.post("/trusted-circle/invite")
async def invite(body: InviteIn, user: dict = Depends(current_user)):
    norm = _normalize_phone(body.phone)
    invitee = None
    if norm:
        async for u in db.users.find({}, {"id": 1, "phone": 1}):
            if _normalize_phone(u.get("phone", "")) == norm and u["id"] != user["id"]:
                invitee = u
                break

    now = datetime.now(timezone.utc).isoformat()
    link_id = str(uuid.uuid4())
    doc = {
        "id": link_id,
        "owner_id": user["id"],
        "owner_name": user.get("name") or "A DHARA user",
        "contact_name": body.name.strip(),
        "contact_phone": body.phone.strip(),
        "invitee_user_id": invitee["id"] if invitee else None,
        "permissions": body.permissions.dict(),
        "relationship": body.relationship.strip() if body.relationship else None,
        "status": "pending",
        "muted": False,
        "created_at": now,
        "responded_at": None,
    }
    # A43/A48: a trusted person without a DHARA account needs some way in.
    # An invitation link is minted for EVERY such contact, whether or not an
    # address was given, because the link is what makes the invitation
    # possible at all:
    #   * we email it when there is an address and email is configured (A43);
    #   * we hand it back to HER so she can send it however she likes —
    #     WhatsApp, her own SMS, in person (A48).
    # The second is the one that works everywhere: it needs no mail server,
    # no DLT registration and no app on his phone.
    email = ge.normalise_email(body.email) if not invitee else None
    invite_token = None
    if not invitee:
        invite_token, token_hash = ge.new_token()
        # The "see her last known area" token is derived from the link id and
        # a server secret, so every alert email can rebuild the same address
        # without the plain token ever being stored. Only its hash is kept,
        # for the lookup when someone opens it.
        view_token = ge.view_token_for(link_id)
        doc.update({
            "channel":            "email" if email else "link",
            "invite_token_hash":  token_hash,   # the token itself is never stored
            "view_token_hash":    ge.hash_token(view_token) if view_token else None,
            "invited_at":         ge.utc_now_iso(),
        })
        if email:
            doc["contact_email"] = email
            doc["email_invited_at"] = ge.utc_now_iso()

    await db.trusted_circle_links.insert_one(doc)

    emailed = False
    if email and invite_token:
        emailed = await _send_invite_email(doc, invite_token)

    if invitee:
        try:
            await send_push(
                recipients=[invitee["id"]],
                data={
                    "title": "Trusted Circle invitation",
                    "message": f"{doc['owner_name']} wants to add you to their Trusted Circle",
                    "action_url": f"/invite/{link_id}",
                },
                idempotency_key=f"tc_invite:{link_id}",
            )
        except Exception as e:
            logger.warning("[trusted_circle] push failed (non-fatal): %s", e)

    return {
        "ok": True,
        "id": link_id,
        "matched_existing_user": invitee is not None,
        # A43: the app tells her what actually happened, so she is not left
        # believing someone was contacted when nothing went out.
        "invited_by_email": emailed,
        "email_pending": bool(email) and not emailed,
        # A48: the invitation link, so she can send it herself. The path is
        # always there; the absolute URL only when PUBLIC_BASE_URL is set, so
        # the app falls back to its own backend address. Returned ONLY to the
        # person who created the invitation.
        "invite_path": f"/api/trusted-circle/invitation/email/{invite_token}" if invite_token else None,
        "invite_url": ge.invite_url(invite_token) if invite_token else None,
    }


@router.get("/trusted-circle/invitations")
async def list_invitations(direction: str = "received", user: dict = Depends(current_user)):
    if direction == "sent":
        q = {"owner_id": user["id"]}
    else:
        q = {"invitee_user_id": user["id"]}
    out = []
    async for link in db.trusted_circle_links.find(q).sort("created_at", -1):
        out.append(_public_link(link))
    return out


@router.get("/trusted-circle/invitations/{link_id}")
async def get_invitation(link_id: str, user: dict = Depends(current_user)):
    link = await db.trusted_circle_links.find_one({"id": link_id})
    if not link:
        raise HTTPException(404, "Invitation not found")
    if user["id"] not in (link["owner_id"], link.get("invitee_user_id")):
        raise HTTPException(403, "Not your invitation")
    return _public_link(link)


@router.post("/trusted-circle/invitations/{link_id}/respond")
async def respond(link_id: str, body: RespondIn, user: dict = Depends(current_user)):
    link = await db.trusted_circle_links.find_one({"id": link_id})
    if not link:
        raise HTTPException(404, "Invitation not found")
    if link.get("invitee_user_id") != user["id"]:
        raise HTTPException(403, "This invitation is not addressed to you")
    if link["status"] != "pending":
        raise HTTPException(400, f"Already {link['status']}")
    if body.action not in ("accept", "decline"):
        raise HTTPException(400, "action must be accept or decline")
    new_status = "accepted" if body.action == "accept" else "declined"
    now = datetime.now(timezone.utc).isoformat()
    await db.trusted_circle_links.update_one(
        {"id": link_id}, {"$set": {"status": new_status, "responded_at": now}},
    )
    return {"ok": True, "status": new_status}


@router.post("/trusted-circle/invitations/{link_id}/revoke")
async def revoke(link_id: str, user: dict = Depends(current_user)):
    """Owner-side revoke — immediately blocks any further restricted alert
    reads for this link (alerts_router re-checks link status on every read)."""
    link = await db.trusted_circle_links.find_one({"id": link_id})
    if not link:
        raise HTTPException(404, "Invitation not found")
    if link["owner_id"] != user["id"]:
        raise HTTPException(403, "Not your trusted circle")
    await db.trusted_circle_links.update_one(
        {"id": link_id}, {"$set": {"status": "revoked", "responded_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


@router.post("/trusted-circle/invitations/{link_id}/leave")
async def leave(link_id: str, user: dict = Depends(current_user)):
    """Recipient-side: leave a trusted circle they previously accepted."""
    link = await db.trusted_circle_links.find_one({"id": link_id})
    if not link:
        raise HTTPException(404, "Invitation not found")
    if link.get("invitee_user_id") != user["id"]:
        raise HTTPException(403, "Not your membership")
    await db.trusted_circle_links.update_one(
        {"id": link_id}, {"$set": {"status": "left", "responded_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


@router.patch("/trusted-circle/invitations/{link_id}/mute")
async def mute(link_id: str, body: MuteIn, user: dict = Depends(current_user)):
    link = await db.trusted_circle_links.find_one({"id": link_id})
    if not link:
        raise HTTPException(404, "Invitation not found")
    if link.get("invitee_user_id") != user["id"]:
        raise HTTPException(403, "Not your membership")
    await db.trusted_circle_links.update_one({"id": link_id}, {"$set": {"muted": body.muted}})
    return {"ok": True, "muted": body.muted}


@router.patch("/trusted-circle/invitations/{link_id}/permissions")
async def update_permissions(link_id: str, body: PermissionsPatchIn, user: dict = Depends(current_user)):
    """Owner-only: change what this trusted-circle member is allowed to
    receive GOING FORWARD — this is a standing setting on the link, same as
    what inviteContact() sets once at invite time, NOT scoped to a single
    journey. (There is deliberately no per-journey override layer today —
    journey_router.py's alert fan-out reads a link's standing permissions
    directly with no additional journey-level gate — so editing permissions
    here is the only way to change what a person receives, and it affects
    every future journey with them, not just the one being set up when a
    caller happens to open this.) Any client surfacing this as a toggle
    should say so plainly, not imply it's scoped to "this journey only".

    Takes effect immediately for every future alert on this link —
    alerts_router.py already re-reads a link's permissions live on every
    read, never a value cached at an earlier point, so no separate
    propagation step is needed here.
    """
    link = await db.trusted_circle_links.find_one({"id": link_id})
    if not link:
        raise HTTPException(404, "Invitation not found")
    if link["owner_id"] != user["id"]:
        raise HTTPException(403, "Not your trusted circle")
    if link["status"] not in ("pending", "accepted"):
        raise HTTPException(400, f"Cannot change permissions on a {link['status']} link")
    changes = body.dict(exclude_unset=True)
    if not changes:
        return {"ok": True, "permissions": link.get("permissions", {})}
    await db.trusted_circle_links.update_one(
        {"id": link_id},
        {"$set": {f"permissions.{k}": v for k, v in changes.items()}},
    )
    updated = await db.trusted_circle_links.find_one({"id": link_id})
    return {"ok": True, "permissions": updated.get("permissions", {})}


@router.get("/trusted-circle/accepted")
async def accepted_recipients(user: dict = Depends(current_user)):
    """For Head Out's recipient picker — only links the OWNER sent that the
    other side has ACCEPTED (i.e. real, consenting recipients)."""
    out = []
    async for link in db.trusted_circle_links.find({"owner_id": user["id"], "status": "accepted"}):
        out.append(_public_link(link))
    return out