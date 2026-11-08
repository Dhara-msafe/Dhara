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
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from dependencies import db, current_user, logger

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
        "created_at": link["created_at"],
        "responded_at": link.get("responded_at"),
    }


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
    await db.trusted_circle_links.insert_one(doc)

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

    return {"ok": True, "id": link_id, "matched_existing_user": invitee is not None}


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
