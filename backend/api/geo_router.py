"""
Geo autocomplete / details proxy — Head Out destination search (Places v1 pilot).

Adds real type-ahead address search (`/api/geo/autocomplete`, `/api/geo/details`)
on top of the existing GO1A manual-search contract (`/api/geocode/search`,
untouched — see geocode_router.py). This is a SEPARATE, additive endpoint
pair so that when the feature flag below is OFF, nothing about today's
behaviour changes at all.

Design — provider seam:
  `GeoProvider` is a tiny interface (`autocomplete`, `details`).
  `GooglePlacesProvider` — Places API (New), server-side key only, never
  shipped to the client — is the only implementation. There is
  deliberately no OpenStreetMap/Nominatim fallback behind this pilot: if
  Google errors, times out, or the flag/key isn't configured, both
  endpoints fail closed (503/502) rather than silently substituting a
  different provider's results under the same "it's working" UI state.
  The actual fallback for address search living alongside this pilot is
  the pre-existing, fully separate `/api/geocode/search` manual
  Search-button flow in geocode_router.py — visibly a different action
  the user takes, never swapped in transparently.

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

import logging
import math
import os
import re
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

# ── Directions (Head Out live route / ETA / route-adherence — separate flag,
# separate key from Places above, same fail-closed-to-approximation pattern) ──
FEATURE_GOOGLE_DIRECTIONS_V1 = _flag_on("FEATURE_GOOGLE_DIRECTIONS_V1")
GOOGLE_DIRECTIONS_SERVER_KEY = os.getenv("GOOGLE_DIRECTIONS_SERVER_KEY", "").strip()
DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"
# Walking, not driving — Head Out journeys are framed as personal/pedestrian
# check-ins (destinations like "Hostel"), not vehicle trips.
_DIRECTIONS_MODE = "walking"
# Used only by the approximate fallback below — an assumed walking pace,
# never shown as anything but an estimate.
_ASSUMED_WALK_MPS = 1.4   # ~5 km/h

AUTOCOMPLETE_FIELD_MASK = (
    "suggestions.placePrediction.placeId,"
    "suggestions.placePrediction.text,"
    "suggestions.placePrediction.structuredFormat"
)
DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location"

_SESSION_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


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

    async def autocomplete(self, query: str, session_token: str, limit: int) -> List[GeoSuggestion]: ...

    async def details(self, place_id: str, session_token: str) -> Optional[GeoDetails]: ...


class GooglePlacesProvider:
    """Places API (New) — https://places.googleapis.com/v1/*"""
    name = "google"

    def __init__(self, server_key: str):
        self._key = server_key

    async def autocomplete(self, query: str, session_token: str, limit: int) -> List[GeoSuggestion]:
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
):
    provider = _active_provider()
    if provider is None:
        # Feature off (or key missing) — fail closed. Frontend falls back to
        # the existing manual Search-button + /api/geocode/search flow.
        raise HTTPException(503, "Places autocomplete is not enabled")
    if not _SESSION_TOKEN_RE.match(session_token):
        raise HTTPException(400, "Invalid session token")

    try:
        suggestions = await provider.autocomplete(input.strip(), session_token, limit)
        return {"suggestions": [s.model_dump() for s in suggestions], "provider": provider.name}
    except HTTPException:
        raise
    except Exception as e:
        # Fail closed — no silent OSM substitution under the same "it worked"
        # response shape. The frontend's existing fail-closed handling hides
        # this dropdown on any error; the visibly separate manual Search
        # button (/api/geocode/search) remains the real fallback.
        logger.warning("geo_autocomplete: %s provider failed (%s)", provider.name, e)
        raise HTTPException(502, "Address search is temporarily unavailable. Try again shortly.")


@router.get("/geo/details", response_model=dict)
async def geo_details(
    place_id: str = Query(..., min_length=1, max_length=512),
    session_token: str = Query(..., min_length=8, max_length=64),
    provider: str = Query("google", pattern="^google$"),
):
    if not _SESSION_TOKEN_RE.match(session_token):
        raise HTTPException(400, "Invalid session token")

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


# ── Nearest Help (in-app Nearby/Text Search — replaces external-maps-only) ──
# Same flag/key as the autocomplete pilot above (FEATURE_GOOGLE_PLACES_V1,
# GOOGLE_PLACES_SERVER_KEY) — this is the same Places API (New) product,
# same billing/quota pool. Fails closed (503/502) with no OSM equivalent;
# the frontend's existing "open in external Maps" action is the fallback.
#
# Results are raw Google Places data — never labelled as officially
# verified government facilities. The frontend must keep that framing.

PLACES_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
NEARBY_RESULT_FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,"
    "places.location,places.nationalPhoneNumber"
)
_NEARBY_INCLUDED_TYPES = {"police": ["police"], "hospital": ["hospital"]}


class NearbyPlace(BaseModel):
    place_id: str
    name: str
    address: str
    latitude: float
    longitude: float
    phone: Optional[str] = None
    distance_meters: int


def _parse_places_response(data: dict, origin_lat: float, origin_lng: float) -> List[NearbyPlace]:
    out: List[NearbyPlace] = []
    for p in data.get("places", []):
        loc = p.get("location") or {}
        plat, plng = loc.get("latitude"), loc.get("longitude")
        if plat is None or plng is None:
            continue
        out.append(NearbyPlace(
            place_id=p.get("id", ""),
            name=(p.get("displayName") or {}).get("text") or "Unnamed location",
            address=p.get("formattedAddress", ""),
            latitude=plat,
            longitude=plng,
            phone=p.get("nationalPhoneNumber"),
            distance_meters=round(_haversine_meters(origin_lat, origin_lng, plat, plng)),
        ))
    out.sort(key=lambda r: r.distance_meters)
    return out


@router.get("/geo/nearby", response_model=dict)
async def geo_nearby(
    category: str = Query(..., pattern="^(police|hospital)$"),
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_meters: int = Query(5000, ge=200, le=50000),
):
    if not FEATURE_GOOGLE_PLACES_V1 or not GOOGLE_PLACES_SERVER_KEY:
        raise HTTPException(503, "Nearby search is not enabled")
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_SERVER_KEY,
        "X-Goog-FieldMask": NEARBY_RESULT_FIELD_MASK,
    }
    payload = {
        "includedTypes": _NEARBY_INCLUDED_TYPES[category],
        "maxResultCount": 10,
        "languageCode": "en",
        "locationRestriction": {
            "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": float(radius_meters)},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(PLACES_NEARBY_URL, headers=headers, json=payload)
        resp.raise_for_status()
        results = _parse_places_response(resp.json(), lat, lng)
    except Exception as e:
        logger.warning("geo_nearby: %s search failed: %s", category, e)
        raise HTTPException(502, "Nearby search is temporarily unavailable. Try again shortly.")
    return {"results": [r.model_dump() for r in results], "provider": "google"}


@router.get("/geo/search-text", response_model=dict)
async def geo_search_text(
    query: str = Query(..., min_length=3, max_length=120),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
):
    if not FEATURE_GOOGLE_PLACES_V1 or not GOOGLE_PLACES_SERVER_KEY:
        raise HTTPException(503, "Text search is not enabled")
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_SERVER_KEY,
        "X-Goog-FieldMask": NEARBY_RESULT_FIELD_MASK,
    }
    payload: dict = {"textQuery": query.strip(), "languageCode": "en"}
    has_location = lat is not None and lng is not None
    if has_location:
        payload["locationBias"] = {
            "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 20000.0},
        }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(PLACES_TEXT_SEARCH_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning("geo_search_text: search failed: %s", e)
        raise HTTPException(502, "Search is temporarily unavailable. Try again shortly.")

    if has_location:
        results = [r.model_dump() for r in _parse_places_response(data, lat, lng)]
    else:
        # No distance to sort/compute by — still return results, omitting it.
        results = []
        for p in data.get("places", []):
            loc = p.get("location") or {}
            plat, plng = loc.get("latitude"), loc.get("longitude")
            if plat is None or plng is None:
                continue
            results.append({
                "place_id": p.get("id", ""),
                "name": (p.get("displayName") or {}).get("text") or "Unnamed location",
                "address": p.get("formattedAddress", ""),
                "latitude": plat,
                "longitude": plng,
                "phone": p.get("nationalPhoneNumber"),
                "distance_meters": None,
            })
    return {"results": results, "provider": "google"}


# ── Directions (Head Out: live route line, ETA, route-adherence) ────────────

class DirectionsResult(BaseModel):
    polyline: List[List[float]]   # [[lat, lng], ...], decoded server-side
    distance_meters: int
    duration_seconds: int
    provider: str   # "google" | "approximate"


def _haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0   # Earth radius, metres
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _decode_polyline(encoded: str) -> List[List[float]]:
    """Standard Google polyline algorithm decoder. No third-party dependency
    needed — this is the same ~20-line algorithm Google's own client libraries
    implement; see https://developers.google.com/maps/documentation/utilities/polylinealgorithm."""
    points: List[List[float]] = []
    index = lat = lng = 0
    length = len(encoded)
    while index < length:
        for is_lat in (True, False):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if is_lat:
                lat += delta
            else:
                lng += delta
        points.append([lat / 1e5, lng / 1e5])
    return points


def _approximate_route(origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float) -> DirectionsResult:
    """Fallback when Directions is off/unkeyed/erroring: a straight line and a
    duration estimate from an assumed walking pace. Never mixed up with a real
    route — callers must label this as approximate (provider == "approximate")."""
    dist = _haversine_meters(origin_lat, origin_lng, dest_lat, dest_lng)
    return DirectionsResult(
        polyline=[[origin_lat, origin_lng], [dest_lat, dest_lng]],
        distance_meters=round(dist),
        duration_seconds=round(dist / _ASSUMED_WALK_MPS),
        provider="approximate",
    )


async def _google_route(origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float) -> DirectionsResult:
    params = {
        "origin": f"{origin_lat},{origin_lng}",
        "destination": f"{dest_lat},{dest_lng}",
        "mode": _DIRECTIONS_MODE,
        "key": GOOGLE_DIRECTIONS_SERVER_KEY,
    }
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.get(DIRECTIONS_URL, params=params)
    resp.raise_for_status()
    data = resp.json()
    if data.get("status") != "OK" or not data.get("routes"):
        raise RuntimeError(f"Directions API status: {data.get('status')}")
    route = data["routes"][0]
    leg = route["legs"][0]
    return DirectionsResult(
        polyline=_decode_polyline(route["overview_polyline"]["points"]),
        distance_meters=leg["distance"]["value"],
        duration_seconds=leg["duration"]["value"],
        provider="google",
    )


@router.get("/geo/directions", response_model=dict)
async def geo_directions(
    origin_lat: float = Query(..., ge=-90, le=90),
    origin_lng: float = Query(..., ge=-180, le=180),
    dest_lat: float = Query(..., ge=-90, le=90),
    dest_lng: float = Query(..., ge=-180, le=180),
):
    """Route line + ETA for an active Head Out journey. Fails OPEN to an
    approximate straight-line estimate rather than erroring the caller out —
    an active safety journey's map should never go blank just because the
    Directions flag/key isn't configured or Google is briefly unavailable.
    Unlike geo_autocomplete, there is no free third-party routing fallback
    used here (OSRM's public demo server is not production-safe to depend
    on) — "approximate" IS the fallback, clearly labelled via `provider`."""
    if not FEATURE_GOOGLE_DIRECTIONS_V1 or not GOOGLE_DIRECTIONS_SERVER_KEY:
        return _approximate_route(origin_lat, origin_lng, dest_lat, dest_lng).model_dump()
    try:
        result = await _google_route(origin_lat, origin_lng, dest_lat, dest_lng)
        return result.model_dump()
    except Exception as e:
        logger.warning("geo_directions: google provider failed (%s), using approximate route", e)
        return _approximate_route(origin_lat, origin_lng, dest_lat, dest_lng).model_dump()
