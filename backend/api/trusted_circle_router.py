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


class RespondIn(BaseModel):
    action: str   # "accept" | "decline"


class MuteIn(BaseModel):
    muted: bool


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


@router.get("/trusted-circle/accepted")
async def accepted_recipients(user: dict = Depends(current_user)):
    """For Head Out's recipient picker — only links the OWNER sent that the
    other side has ACCEPTED (i.e. real, consenting recipients)."""
    out = []
    async for link in db.trusted_circle_links.find({"owner_id": user["id"], "status": "accepted"}):
        out.append(_public_link(link))
    return out
