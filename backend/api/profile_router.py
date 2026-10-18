"""Profile photo — upload / retrieve / remove / visibility.

Part P1 of the Trusted Circle Recipient + Profile Photo build. New, additive:
does not touch FIR evidence storage (fir_storage.py) or Evidence Locker.

Security (per the authorized spec):
  - Real content/MIME is sniffed server-side via Pillow — filename extension
    is never trusted.
  - Resized to 512x512, EXIF stripped (Pillow re-encode drops all metadata
    including GPS/device tags by default — we never copy EXIF across).
  - 5 MB cap enforced AFTER processing (re-encoded size), not on the raw
    upload, so a large-but-compressible file isn't rejected unfairly.
  - No SVG/HTML/executable can ever be stored — Pillow.open() raises on
    anything that isn't a real raster image, and we re-encode to JPEG
    ourselves rather than trusting the input bytes.
  - Download is a private, authenticated endpoint — never a public/
    predictable storage path. Authorization: self, OR an ACCEPTED trusted
    circle recipient when the owner's visibility is "accepted_circle".
  - A `photo_version` (uuid4) is bumped on every upload/remove so clients
    can bust stale caches; removing sets photo_path=None (default avatar).
"""
from __future__ import annotations

import io
import uuid
from typing import Optional

import jwt
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from fastapi.responses import Response
from pydantic import BaseModel
from PIL import Image, UnidentifiedImageError

from dependencies import db, current_user, current_user_optional, logger
from config.settings import JWT_SECRET, JWT_ALG
from services.object_storage import put_object, get_object, APP_NAME

_PHOTO_TOKEN_PURPOSE = "photo_view"
_PHOTO_TOKEN_MINUTES = 30


def _make_photo_view_token(user_id: str) -> str:
    """Separate, short-lived, single-purpose token — NOT the main session
    JWT, and NOT the guardian-journey share token. Only usable at
    GET /profile/photo/{id}, only for 30 minutes."""
    payload = {
        "sub": user_id,
        "purpose": _PHOTO_TOKEN_PURPOSE,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=_PHOTO_TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def _decode_photo_view_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != _PHOTO_TOKEN_PURPOSE:
        return None
    return await db.users.find_one({"id": payload["sub"]}, {"_id": 0})

router = APIRouter()

MAX_PROCESSED_BYTES = 5 * 1024 * 1024   # 5 MB, enforced after re-encoding
TARGET_SIZE = (512, 512)
ALLOWED_INPUT_FORMATS = {"JPEG", "PNG", "WEBP", "MPO", "HEIF"}  # Pillow's reported format names


class VisibilityIn(BaseModel):
    mode: str   # "only_me" | "accepted_circle"


class EditProfileIn(BaseModel):
    name: Optional[str] = None


def _process_image(raw: bytes) -> bytes:
    """Validate real content, strip metadata, square-crop + resize to 512x512,
    re-encode as JPEG. Raises HTTPException on anything invalid."""
    try:
        img = Image.open(io.BytesIO(raw))
        img.verify()  # catches truncated/corrupt files
        img = Image.open(io.BytesIO(raw))  # re-open: verify() consumes the parser
    except UnidentifiedImageError:
        raise HTTPException(400, "Unsupported or corrupt image file")
    except Exception:
        raise HTTPException(400, "Could not read this image file")

    fmt = (img.format or "").upper()
    if fmt not in ALLOWED_INPUT_FORMATS:
        raise HTTPException(400, f"Unsupported image format: {fmt or 'unknown'}. Use JPEG, PNG, WebP or HEIC.")

    # Convert to RGB (drops alpha/CMYK oddities) — a fresh Image.new() means
    # no EXIF/ICC/GPS chunk from the source ever gets carried over.
    img = img.convert("RGB")

    # Centre square-crop, then resize — a clean, predictable profile thumb.
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize(TARGET_SIZE, Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=88, optimize=True)  # fresh encode — no input metadata survives
    data = out.getvalue()
    if len(data) > MAX_PROCESSED_BYTES:
        raise HTTPException(400, "Image is too large even after compression. Try a different photo.")
    return data


async def _is_authorized_viewer(owner: dict, viewer_id: str) -> bool:
    if owner["id"] == viewer_id:
        return True
    visibility = owner.get("photo_visibility", "only_me")
    if visibility != "accepted_circle":
        return False
    link = await db.trusted_circle_links.find_one({
        "owner_id": owner["id"], "invitee_user_id": viewer_id, "status": "accepted",
    })
    return link is not None


@router.post("/profile/photo")
async def upload_profile_photo(file: UploadFile = File(...), user: dict = Depends(current_user)):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    if len(raw) > 15 * 1024 * 1024:   # generous raw cap before we even try to decode
        raise HTTPException(400, "File too large")
    processed = _process_image(raw)

    version = uuid.uuid4().hex[:12]
    path = f"{APP_NAME}/uploads/{user['id']}/profile_{version}.jpg"
    try:
        await put_object(path, processed, "image/jpeg")
    except Exception as e:
        logger.error("[profile_photo] storage upload failed: %s", e)
        raise HTTPException(503, "Could not upload right now. Please try again.")

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"photo_path": path, "photo_version": version}},
    )
    return {"photo_version": version, "photo_url": f"/api/profile/photo/{user['id']}?v={version}"}


@router.delete("/profile/photo")
async def remove_profile_photo(user: dict = Depends(current_user)):
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"photo_path": None, "photo_version": None}},
    )
    return {"ok": True}


@router.patch("/profile/visibility")
async def set_photo_visibility(body: VisibilityIn, user: dict = Depends(current_user)):
    if body.mode not in ("only_me", "accepted_circle"):
        raise HTTPException(400, "Invalid visibility mode")
    await db.users.update_one({"id": user["id"]}, {"$set": {"photo_visibility": body.mode}})
    return {"ok": True, "mode": body.mode}


@router.patch("/profile/me")
async def edit_profile(body: EditProfileIn, user: dict = Depends(current_user)):
    updates = {}
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "Name cannot be empty")
        updates["name"] = name[:80]
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    return {"ok": True}


@router.get("/profile/photo/{owner_id}")
async def get_profile_photo(
    owner_id: str,
    v: Optional[str] = Query(None),
    token: Optional[str] = Query(None),   # web <img> can't send Authorization — short-lived query token instead
    header_user: Optional[dict] = Depends(current_user_optional),
):
    # Accepts auth via EITHER the normal Authorization header (native, and
    # also works if a web caller sets it) OR the short-lived `token` query
    # param (needed because a plain web <img src> cannot send headers).
    viewer = header_user
    if not viewer and token:
        viewer = await _decode_photo_view_token(token)

    owner = await db.users.find_one({"id": owner_id})
    if not owner or not owner.get("photo_path"):
        raise HTTPException(404, "No photo")
    if not viewer or not await _is_authorized_viewer(owner, viewer["id"]):
        raise HTTPException(403, "Not authorized to view this photo")

    try:
        data, content_type = await get_object(owner["photo_path"])
    except Exception as e:
        logger.error("[profile_photo] storage read failed: %s", e)
        raise HTTPException(503, "Photo temporarily unavailable")
    return Response(content=data, media_type=content_type or "image/jpeg")


@router.get("/profile/photo-token")
async def get_photo_view_token(user: dict = Depends(current_user)):
    """Short-lived token for web <img src> tags (which can't send an
    Authorization header). Separate from the guardian journey token system."""
    return {"token": _make_photo_view_token(user["id"])}
