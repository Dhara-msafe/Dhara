"""
Geo autocomplete / details proxy — Head Out destination search (Places v1 pilot).

Adds real type-ahead address search (`/api/geo/autocomplete`, `/api/geo/details`)
on top of the existing GO1A manual-search contract (`/api/geocode/search`,
untouched — see geocode_router.py). This is a SEPARATE, additive endpoint
pair so that when the feature flag below is OFF, nothing about today's
behaviour changes at all.

Design — provider seam:
  `GeoProvider` is a tiny interface (`autocomplete`, `details`). Two
  implementations exist today:
    - `GooglePlacesProvider`  — Places API (New), server-side key only,
      never shipped to the client. Primary provider when the feature is on.
    - `NominatimFallbackProvider` — wraps the same free OpenStreetMap
      Nominatim lookup used by geocode_router.py, reshaped to the same
      suggestion/details contract. Used as an automatic, same-request
      fallback if the Google call errors or times out (keeps the dropdown
      useful instead of going blank), and is also what powers things when
      the Google key/flag isn't configured at all but an operator still
      wants best-effort type-ahead later. "place_id" for this provider is a
      self-contained encoded token (no server state, no second HTTP call
      needed for `details`).

Feature flag (default OFF): FEATURE_GOOGLE_PLACES_V1. When OFF, both
endpoints respond 503 so the frontend's fail-closed logic falls back to the
existing manual `/api/geocode/search` + Search-button flow untouched.

Session tokens (Google Places billing semantics): the client generates one
UUID per search session (first keystroke), reuses it across every
debounced autocomplete call, and sends it once more on the `details` call
after a selection, then discards it. We validate the shape server-side but
otherwise just pass it through to Google.

Mounted at /api/geo/ via server.py.
"""
from __future__ import annotations

import base64
import logging
import os
import re
import time
import asyncio
from typing import List, Optional, Protocol

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger("geo_router")
router = APIRouter()

# ── Feature flag + server key (server-side only — never sent to the client) ──

def _flag_on(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() == "true"

FEATURE_GOOGLE_PLACES_V1 = _flag_on("FEATURE_GOOGLE_PLACES_V1")
GOOGLE_PLACES_SERVER_KEY = os.getenv("GOOGLE_PLACES_SERVER_KEY", "").strip()

PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
PLACES_DETAILS_BASE_URL = "https://places.googleapis.com/v1/places/"

AUTOCOMPLETE_FIELD_MASK = (
    "suggestions.placePrediction.placeId,"
    "suggestions.placePrediction.text,"
    "suggestions.placePrediction.structuredFormat"
)
DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location"

_SESSION_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

# Nominatim fallback reuses the same fair-use pacing already proven safe in
# geocode_router.py (max ~1 request/second, short cache).
_NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
_NOMINATIM_USER_AGENT = "DHARA-Safety-App/1.0 (destination-search pilot; interactive single-user use only)"
_fallback_cache: dict[str, tuple[float, list]] = {}
_fallback_last_request = 0.0
_fallback_lock = asyncio.Lock()
_FALLBACK_CACHE_TTL_S = 300
_FALLBACK_MIN_INTERVAL_S = 1.0


class GeoSuggestion(BaseModel):
    place_id: str
    main_text: str
    secondary_text: str = ""
    provider: str


class GeoDetails(BaseModel):
    label: str
    latitude: float
    longitude: float
    provider: str


# ── Provider interface ───────────────────────────────────────────────────────

class GeoProvider(Protocol):
    name: str

    async def autocomplete(
        self, query: str, session_token: str, limit: int,
        bias: Optional[tuple[float, float]] = None,
    ) -> List[GeoSuggestion]: ...

    async def details(self, place_id: str, session_token: str) -> Optional[GeoDetails]: ...


class GooglePlacesProvider:
    """Places API (New) — https://places.googleapis.com/v1/*"""
    name = "google"

    def __init__(self, server_key: str):
        self._key = server_key

    async def autocomplete(
        self, query: str, session_token: str, limit: int,
        bias: Optional[tuple[float, float]] = None,
    ) -> List[GeoSuggestion]:
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self._key,
            "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
        }
        payload = {
            "input": query,
            "sessionToken": session_token,
            # Bias towards India without excluding the rest of the world —
            # per product decision, never a hard includedRegionCodes filter.
            "regionCode": "IN",
            "languageCode": "en",
        }
        if bias:
            # Soft bias only, and only when the caller already has the user's
            # permission to know where they are.
            payload["locationBias"] = {
                "circle": {
                    "center": {"latitude": bias[0], "longitude": bias[1]},
                    "radius": 20000.0,
                }
            }
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(PLACES_AUTOCOMPLETE_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        out: List[GeoSuggestion] = []
        for item in data.get("suggestions", [])[:limit]:
            pred = item.get("placePrediction")
            if not pred:
                continue
            place_id = pred.get("placeId")
            if not place_id:
                continue
            structured = pred.get("structuredFormat") or {}
            main = (structured.get("mainText") or {}).get("text") or (pred.get("text") or {}).get("text") or ""
            secondary = (structured.get("secondaryText") or {}).get("text") or ""
            out.append(GeoSuggestion(place_id=place_id, main_text=main, secondary_text=secondary, provider=self.name))
        return out

    async def details(self, place_id: str, session_token: str) -> Optional[GeoDetails]:
        if "/" in place_id or "\\" in place_id:
            raise HTTPException(400, "Invalid place id")
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self._key,
            "X-Goog-FieldMask": DETAILS_FIELD_MASK,
        }
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(
                f"{PLACES_DETAILS_BASE_URL}{place_id}",
                params={"sessionToken": session_token},
                headers=headers,
            )
        resp.raise_for_status()
        data = resp.json()
        loc = data.get("location") or {}
        if "latitude" not in loc or "longitude" not in loc:
            return None
        label = (data.get("formattedAddress")
                 or (data.get("displayName") or {}).get("text")
                 or "")
        return GeoDetails(label=label, latitude=loc["latitude"], longitude=loc["longitude"], provider=self.name)


class NominatimFallbackProvider:
    """
    Free OSM fallback — used automatically if Google errors/times out, and
    available as the sole provider once an operator later wants OSM-only
    mode without any frontend changes. No server-side session state: the
    "place_id" is a self-describing base64 token carrying label+coords, so
    `details()` never needs a second network call or a stored session.
    """
    name = "osm"

    @staticmethod
    def _encode(label: str, lat: float, lon: float) -> str:
        raw = f"{lat:.6f}|{lon:.6f}|{label}".encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    @staticmethod
    def _decode(token: str) -> Optional[tuple[float, float, str]]:
        try:
            padded = token + "=" * (-len(token) % 4)
            raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
            lat_s, lon_s, label = raw.split("|", 2)
            return float(lat_s), float(lon_s), label
        except Exception:
            return None

    async def autocomplete(
        self, query: str, session_token: str, limit: int,
        bias: Optional[tuple[float, float]] = None,
    ) -> List[GeoSuggestion]:
        global _fallback_last_request
        key = f"{query.strip().lower()}|{limit}|{round(bias[0], 2) if bias else ''},{round(bias[1], 2) if bias else ''}"
        now = time.monotonic()
        cached = _fallback_cache.get(key)
        if cached and (now - cached[0]) < _FALLBACK_CACHE_TTL_S:
            raw = cached[1]
        else:
            async with _fallback_lock:
                wait = _FALLBACK_MIN_INTERVAL_S - (time.monotonic() - _fallback_last_request)
                if wait > 0:
                    await asyncio.sleep(wait)
                params = {"q": query.strip(), "format": "jsonv2", "addressdetails": 1, "limit": limit}
                if bias:
                    lat, lon = bias
                    # Preference box (~±0.35°), never a hard bound.
                    params["viewbox"] = f"{lon - 0.35},{lat + 0.35},{lon + 0.35},{lat - 0.35}"
                    params["bounded"] = 0
                async with httpx.AsyncClient(timeout=6.0) as client:
                    resp = await client.get(
                        _NOMINATIM_SEARCH_URL,
                        params=params,
                        headers={"User-Agent": _NOMINATIM_USER_AGENT, "Accept-Language": "en"},
                    )
                _fallback_last_request = time.monotonic()
                resp.raise_for_status()
                raw = resp.json()
            _fallback_cache[key] = (now, raw)
            if len(_fallback_cache) > 200:
                # Keep the cache bounded — drop the oldest entries.
                for stale_key in sorted(_fallback_cache, key=lambda k: _fallback_cache[k][0])[:100]:
                    _fallback_cache.pop(stale_key, None)

        out: List[GeoSuggestion] = []
        for item in raw[:limit]:
            try:
                label = item["display_name"]
                lat, lon = float(item["lat"]), float(item["lon"])
            except (KeyError, ValueError, TypeError):
                continue
            parts = [p.strip() for p in label.split(",") if p.strip()]
            main = parts[0] if parts else label
            secondary = ", ".join(parts[1:3])
            out.append(GeoSuggestion(
                place_id=self._encode(label, lat, lon),
                main_text=main, secondary_text=secondary, provider=self.name,
            ))
        return out

    async def details(self, place_id: str, session_token: str) -> Optional[GeoDetails]:
        decoded = self._decode(place_id)
        if not decoded:
            return None
        lat, lon, label = decoded
        return GeoDetails(label=label, latitude=lat, longitude=lon, provider=self.name)


def _active_provider() -> Optional[GeoProvider]:
    if not FEATURE_GOOGLE_PLACES_V1 or not GOOGLE_PLACES_SERVER_KEY:
        return None
    return GooglePlacesProvider(GOOGLE_PLACES_SERVER_KEY)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/geo/autocomplete", response_model=dict)
async def geo_autocomplete(
    input: str = Query(..., min_length=2, max_length=120, alias="input"),
    session_token: str = Query(..., min_length=8, max_length=64),
    limit: int = Query(6, ge=1, le=8),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
):
    if not _SESSION_TOKEN_RE.match(session_token):
        raise HTTPException(400, "Invalid session token")
    # Soft bias, only sent by a client that already has location permission.
    bias = (lat, lng) if lat is not None and lng is not None else None

    provider = _active_provider()
    if provider is None:
        # Google not configured — serve free OSM suggestions instead of failing,
        # so typing still suggests places. Same response shape.
        try:
            fallback = NominatimFallbackProvider()
            suggestions = await fallback.autocomplete(input.strip(), session_token, limit, bias)
            return {"suggestions": [s.model_dump() for s in suggestions], "provider": fallback.name}
        except Exception as e:
            logger.warning("geo_autocomplete: OSM-only lookup failed: %s", e)
            raise HTTPException(502, "Address search is temporarily unavailable. Try again shortly.")

    try:
        suggestions = await provider.autocomplete(input.strip(), session_token, limit, bias)
        return {"suggestions": [s.model_dump() for s in suggestions], "provider": provider.name}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("geo_autocomplete: %s provider failed (%s), trying OSM fallback", provider.name, e)
        try:
            fallback = NominatimFallbackProvider()
            suggestions = await fallback.autocomplete(input.strip(), session_token, limit, bias)
            return {"suggestions": [s.model_dump() for s in suggestions], "provider": fallback.name}
        except Exception as e2:
            logger.warning("geo_autocomplete: OSM fallback also failed: %s", e2)
            raise HTTPException(502, "Address search is temporarily unavailable. Try again shortly.")


@router.get("/geo/details", response_model=dict)
async def geo_details(
    place_id: str = Query(..., min_length=1, max_length=512),
    session_token: str = Query(..., min_length=8, max_length=64),
    provider: str = Query("google", pattern="^(google|osm)$"),
):
    if not _SESSION_TOKEN_RE.match(session_token):
        raise HTTPException(400, "Invalid session token")

    if provider == "osm":
        result = await NominatimFallbackProvider().details(place_id, session_token)
    else:
        active = _active_provider()
        if active is None:
            raise HTTPException(503, "Places autocomplete is not enabled")
        try:
            result = await active.details(place_id, session_token)
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("geo_details: google provider failed: %s", e)
            raise HTTPException(502, "Could not fetch address details. Try again shortly.")

    if result is None:
        raise HTTPException(404, "Place not found")
    return result.model_dump()
