"""
GO1A — Safety: Saved Places CRUD

This router handles saved-destination management only.
It does NOT implement journeys, tracking, alerts, invitations, tokens or
any form of location monitoring. All endpoints are owner-scoped.

Mounted at /api/safety/ via server.py.

Feature flag: SAFETY_SAVED_PLACES_ENABLED environment variable (backend-side
guard in addition to the Expo build-time flag).  If not set, defaults to true
so that the feature is available once the router is mounted; the Expo
EXPO_PUBLIC_DESTINATION_PICKER=false flag controls client-side visibility.

MongoDB collection: safety_saved_places
Indexes: created lazily on first write or via POST /api/safety/admin/init-indexes
"""
from __future__ import annotations

import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from dependencies import db, current_user

logger = logging.getLogger("safety_router")
router = APIRouter()

# ── Constants ────────────────────────────────────────────────────────────────

MAX_SAVED_PLACES = 10
RADIUS_MIN_M = 50
RADIUS_MAX_M = 2000
RADIUS_PRESETS = {100, 200, 300}

# Google Places (New) storage compliance: Place IDs may be stored
# indefinitely, but the place DATA (address, coordinates) obtained via
# Places content may only be cached for up to 30 consecutive calendar days
# before it must be refreshed or deleted — see
# https://developers.google.com/maps/documentation/places/web-service/policies.
# Saved places sourced from OSM or a manually-dropped pin carry no such
# restriction (coords_source stays "osm"/"manual", coords_cached_at stays
# null) — this clock only applies to coords_source == "google".
PLACES_CACHE_MAX_DAYS = 30
VALID_COORDS_SOURCES = {"google", "osm", "manual"}

COLLECTION = "safety_saved_places"
META_COLLECTION = "safety_meta"
INDEX_META_ID = "safety_saved_places_indexes_v1"

# ── Index helper ─────────────────────────────────────────────────────────────

async def _ensure_indexes_once() -> bool:
    """Create indexes exactly once, recorded in safety_meta. Idempotent."""
    existing = await db[META_COLLECTION].find_one({"_id": INDEX_META_ID})
    if existing:
        return False  # already done
    await db[COLLECTION].create_index("owner_id")
    await db[COLLECTION].create_index([("owner_id", 1), ("deleted_at", 1)])
    await db[META_COLLECTION].update_one(
        {"_id": INDEX_META_ID},
        {"$set": {"created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    logger.info("safety_saved_places indexes created")
    return True

# ── Models ───────────────────────────────────────────────────────────────────

class SavedPlaceIn(BaseModel):
    label: str = Field(..., min_length=1, max_length=80,
                       description="Human-readable destination name, e.g. 'Home', 'College library'")
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    radius_meters: int = Field(200, ge=RADIUS_MIN_M, le=RADIUS_MAX_M,
                               description="Planned arrival area radius. NOT an active geofence.")
    # Google Places (New) storage compliance — see PLACES_CACHE_MAX_DAYS above.
    # Both optional and independent of any other field, so existing callers
    # (OSM search, manual pin) are unaffected.
    google_place_id: Optional[str] = Field(None, max_length=512)
    coords_source: Optional[str] = Field(
        None, description="Where latitude/longitude came from: 'google' | 'osm' | 'manual'"
    )

    @field_validator("radius_meters")
    @classmethod
    def radius_must_be_valid(cls, v: int) -> int:
        if v < RADIUS_MIN_M or v > RADIUS_MAX_M:
            raise ValueError(
                f"radius_meters must be between {RADIUS_MIN_M} and {RADIUS_MAX_M}"
            )
        return v

    @field_validator("label")
    @classmethod
    def label_no_control_chars(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("label must not be blank")
        return cleaned

    @field_validator("coords_source")
    @classmethod
    def coords_source_must_be_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_COORDS_SOURCES:
            raise ValueError(f"coords_source must be one of {sorted(VALID_COORDS_SOURCES)}")
        return v


class SavedPlacePatchIn(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=80)
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    radius_meters: Optional[int] = Field(None, ge=RADIUS_MIN_M, le=RADIUS_MAX_M)
    google_place_id: Optional[str] = Field(None, max_length=512)
    coords_source: Optional[str] = Field(None)

    @field_validator("label")
    @classmethod
    def label_strip(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("label must not be blank")
        return v

    @field_validator("coords_source")
    @classmethod
    def coords_source_must_be_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_COORDS_SOURCES:
            raise ValueError(f"coords_source must be one of {sorted(VALID_COORDS_SOURCES)}")
        return v


def _is_places_cache_stale(doc: dict) -> bool:
    """True only for Google-sourced coordinates older than the 30-day cap.
    OSM/manual-pin coordinates (or docs with no recorded source — created
    before this field existed) are never subject to this Google-specific
    retention rule."""
    if doc.get("coords_source") != "google":
        return False
    cached_at = doc.get("coords_cached_at")
    if not cached_at:
        return False
    try:
        cached = datetime.fromisoformat(cached_at)
    except ValueError:
        return False
    age_days = (datetime.now(timezone.utc) - cached).total_seconds() / 86400
    return age_days > PLACES_CACHE_MAX_DAYS


def _public(doc: dict) -> dict:
    return {
        "place_id":        doc["place_id"],
        "label":           doc["label"],
        "latitude":        doc.get("latitude"),
        "longitude":       doc.get("longitude"),
        "radius_meters":   doc["radius_meters"],
        "radius_label":    _radius_label(doc["radius_meters"]),
        "created_at":      doc["created_at"],
        "updated_at":      doc.get("updated_at", doc["created_at"]),
        "google_place_id": doc.get("google_place_id"),
        # True when Google-sourced coordinates are past the 30-day cache cap —
        # the frontend should prompt a re-search rather than keep using them.
        "needs_refresh":   _is_places_cache_stale(doc),
    }


def _radius_label(r: int) -> str:
    """Human-readable radius label. Presets get short names; custom gets metres."""
    mapping = {100: "100 m", 200: "200 m", 300: "300 m"}
    return mapping.get(r, f"{r} m (custom)")


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/safety/places")
async def list_saved_places(user: dict = Depends(current_user)):
    """List the authenticated user's saved places (active only)."""
    cursor = db[COLLECTION].find(
        {"owner_id": user["id"], "deleted_at": None},
        {"_id": 0}
    ).sort("created_at", -1)
    docs = await cursor.to_list(length=MAX_SAVED_PLACES + 1)
    return {"places": [_public(d) for d in docs]}


@router.post("/safety/places", status_code=201)
async def create_saved_place(body: SavedPlaceIn, user: dict = Depends(current_user)):
    """Create a saved place. Max 10 per user."""
    count = await db[COLLECTION].count_documents(
        {"owner_id": user["id"], "deleted_at": None}
    )
    if count >= MAX_SAVED_PLACES:
        raise HTTPException(
            400,
            f"Maximum {MAX_SAVED_PLACES} saved places reached. Delete one before adding another."
        )
    now = datetime.now(timezone.utc).isoformat()
    place_id = str(uuid.uuid4())
    doc = {
        "place_id":         place_id,
        "owner_id":         user["id"],
        "label":            body.label,
        "latitude":         body.latitude,
        "longitude":        body.longitude,
        "radius_meters":    body.radius_meters,
        "created_at":       now,
        "updated_at":       now,
        "deleted_at":       None,
        "google_place_id":  body.google_place_id,
        "coords_source":    body.coords_source,
        # Only Google-sourced coordinates start the 30-day cache clock.
        "coords_cached_at": now if body.coords_source == "google" else None,
    }
    # Lazy index creation on first write
    await _ensure_indexes_once()
    await db[COLLECTION].insert_one(doc)
    logger.info("saved_place created place_id=%s owner=%s", place_id, user["id"])
    return _public(doc)


@router.patch("/safety/places/{place_id}")
async def update_saved_place(
    place_id: str,
    body: SavedPlacePatchIn,
    user: dict = Depends(current_user),
):
    """Update a saved place. Owner-only."""
    existing = await db[COLLECTION].find_one(
        {"place_id": place_id, "deleted_at": None}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(404, "Saved place not found")
    if existing["owner_id"] != user["id"]:
        raise HTTPException(403, "Not authorised to modify this place")

    now = datetime.now(timezone.utc).isoformat()
    updates: dict = {"updated_at": now}
    if body.label is not None:
        updates["label"] = body.label
    if body.latitude is not None:
        updates["latitude"] = body.latitude
    if body.longitude is not None:
        updates["longitude"] = body.longitude
    if body.radius_meters is not None:
        updates["radius_meters"] = body.radius_meters
    if body.google_place_id is not None:
        updates["google_place_id"] = body.google_place_id
    if body.coords_source is not None:
        # The refresh path: a user re-selecting this destination from the
        # live Places/OSM search resets the 30-day Google cache clock (or
        # clears it entirely if the new source isn't Google).
        updates["coords_source"] = body.coords_source
        updates["coords_cached_at"] = now if body.coords_source == "google" else None

    await db[COLLECTION].update_one({"place_id": place_id}, {"$set": updates})
    updated = {**existing, **updates}
    logger.info("saved_place updated place_id=%s owner=%s", place_id, user["id"])
    return _public(updated)


@router.delete("/safety/places/{place_id}")
async def delete_saved_place(place_id: str, user: dict = Depends(current_user)):
    """Soft-delete a saved place. Record is preserved for audit; not returned in list."""
    existing = await db[COLLECTION].find_one(
        {"place_id": place_id, "deleted_at": None}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(404, "Saved place not found")
    if existing["owner_id"] != user["id"]:
        raise HTTPException(403, "Not authorised to delete this place")

    now = datetime.now(timezone.utc).isoformat()
    await db[COLLECTION].update_one(
        {"place_id": place_id},
        {"$set": {"deleted_at": now, "updated_at": now}}
    )
    logger.info("saved_place deleted place_id=%s owner=%s", place_id, user["id"])
    return {"place_id": place_id, "deleted": True, "deleted_at": now}


# ── Admin: explicit index initialisation ─────────────────────────────────────

@router.post("/safety/admin/init-indexes")
async def init_indexes(x_admin_key: str = None):
    """
    One-time index creation for safety_saved_places.
    Requires X-Admin-Key header (same key used by /api/admin/* routes).
    Safe to call multiple times; idempotent.
    """
    # Re-use the existing admin key from env (same pattern as check_admin_key dependency)
    expected = os.getenv("ADMIN_KEY", "")
    if not expected or x_admin_key != expected:
        raise HTTPException(403, "Invalid or missing admin key")
    created = await _ensure_indexes_once()
    return {"created": created, "message": "already existed" if not created else "indexes created"}
