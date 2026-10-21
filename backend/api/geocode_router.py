"""
Geocode / address search proxy.

GO1A map pilot — real address search, upgraded from the manual-label-only
picker. Proxies free-text address search to a geocoding provider
(OpenStreetMap Nominatim today). Deliberately architected so a paid
provider (e.g. Google Places) can be swapped in later behind this same
`/api/geocode/search` contract without any frontend changes.

Mounted at /api/geocode/ via server.py.

Usage-policy compliance (Nominatim): requests are made server-side with a
proper identifying User-Agent, and are rate-limited/cached briefly to stay
within Nominatim's fair-use policy (max ~1 request/second, no bulk/heavy
traffic). This endpoint is for interactive, single-user destination search
only — never for bulk/batch geocoding.

Still OUT of scope here: Routes/Directions, reverse geocoding of live GPS
coordinates, and any Google Places/Maps billed API (tracked separately —
see frontend/.env comments for the GO1B GPS flags, which remain OFF).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import List

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger("geocode_router")
router = APIRouter()

NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "DHARA-Safety-App/1.0 (destination-search pilot; interactive single-user use only)"

_CACHE_TTL_SECONDS = 300
_MIN_INTERVAL_SECONDS = 1.0  # Nominatim fair-use: max ~1 request/second

# Process-local cache + pacing lock. Good enough for interactive search
# traffic; not a distributed cache/limiter (acceptable for this pilot scope).
_cache: dict[str, tuple[float, list]] = {}
_last_request_time = 0.0
_pacing_lock = asyncio.Lock()


class AddressSuggestion(BaseModel):
    label: str
    latitude: float
    longitude: float


@router.get("/geocode/search", response_model=dict)
async def geocode_search(
    q: str = Query(..., min_length=2, max_length=120, description="Free-text address query"),
    limit: int = Query(5, ge=1, le=8),
):
    """Address search for the destination picker. Returns up to `limit` suggestions."""
    global _last_request_time

    key = f"{q.strip().lower()}|{limit}"
    now = time.monotonic()

    cached = _cache.get(key)
    if cached and (now - cached[0]) < _CACHE_TTL_SECONDS:
        return {"suggestions": cached[1]}

    async with _pacing_lock:
        wait = _MIN_INTERVAL_SECONDS - (time.monotonic() - _last_request_time)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(
                    NOMINATIM_SEARCH_URL,
                    params={
                        "q": q.strip(),
                        "format": "jsonv2",
                        "addressdetails": 1,
                        "limit": limit,
                    },
                    headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
                )
            _last_request_time = time.monotonic()
            resp.raise_for_status()
            raw = resp.json()
        except Exception as e:
            logger.warning("geocode_search upstream error for query=%r: %s", q, e)
            raise HTTPException(502, "Address search is temporarily unavailable. Try again shortly.")

    suggestions: List[dict] = []
    for item in raw:
        try:
            suggestions.append({
                "label": item["display_name"],
                "latitude": float(item["lat"]),
                "longitude": float(item["lon"]),
            })
        except (KeyError, ValueError, TypeError):
            continue

    _cache[key] = (now, suggestions)
    return {"suggestions": suggestions}
