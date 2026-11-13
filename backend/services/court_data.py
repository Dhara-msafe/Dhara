"""Court Data Engine — isolated wrapper around the eCourtsIndia partner API.

Mirrors the AI-Gateway pattern (services/ai_gateway.py):

  • Central config (ECOURTS_TOKEN + ECOURTS_BASE resolved once here).
  • Structured logging with a stable `error_id` per call.
  • Graceful failure — upstream 429/5xx / timeouts / SSL errors do NOT bubble
    up as raw HTTPExceptions from deep inside the route. They surface as a
    `CourtDataResult` with `status="unavailable"` and a user-safe message, so
    the caller can decide whether to convert to 502/503 or degrade the UI.
  • Simple circuit breaker — after N consecutive upstream failures the engine
    fast-fails for COOLDOWN_S seconds instead of hammering a dead partner.
  • Zero behaviour change for the happy path — response shape identical to
    what `_nc()` used to return in server.py.

Why isolate: eCourts is a third-party partner whose SLA we do not control.
Keeping the failure envelope local means chat, FIR drafting, and voice
transcription cannot be dragged down by a court-lookup outage.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger("court_data")

# ── Config ────────────────────────────────────────────────────────────────────

ECOURTS_TOKEN = os.getenv("ECOURTS_API_TOKEN", "")
ECOURTS_BASE  = os.getenv("ECOURTS_API_BASE", "https://webapi.ecourtsindia.com")
TIMEOUT_S     = float(os.getenv("ECOURTS_TIMEOUT_S", "20"))
MAX_RETRIES   = int(os.getenv("ECOURTS_MAX_RETRIES", "3"))

# Circuit breaker — trip after this many consecutive failures, stay tripped
# for COOLDOWN_S before probing again.
BREAKER_TRIP_AFTER = int(os.getenv("ECOURTS_BREAKER_TRIP_AFTER", "5"))
BREAKER_COOLDOWN_S = float(os.getenv("ECOURTS_BREAKER_COOLDOWN_S", "60"))

# 24h cache on successful CNR lookups — see `_cache_get` / `_cache_put` below.
CNR_CACHE_TTL_S = int(os.getenv("COURT_CNR_CACHE_TTL_S", "86400"))

CNR_RE = re.compile(r"^[A-Z]{4}\d{12}$")


# ── Result envelope ───────────────────────────────────────────────────────────

@dataclass
class CourtDataResult:
    status: str                                    # "ok" | "unavailable" | "not_found" | "invalid"
    data: Any = None                               # normalised payload when status == "ok"
    error_id: str = ""                             # correlation ID for logs
    message: str = ""                              # user-safe message
    http_hint: int = 0                             # suggested HTTP status if the caller re-raises
    upstream_status: Optional[int] = None
    upstream_detail: str = ""
    from_cache: bool = False                       # True when served from the 24h Mongo cache

    def is_ok(self) -> bool:
        return self.status == "ok"

    def to_dict(self) -> dict:
        d = {"status": self.status, "error_id": self.error_id, "message": self.message}
        if self.status == "ok":
            d["data"] = self.data
        return d


@dataclass
class _BreakerState:
    consecutive_failures: int = 0
    open_until_ts: float = 0.0
    total_ok: int = 0
    total_fail: int = 0
    last_error_id: str = ""
    alert_fired: bool = False   # True once the "breaker opened" alert has fired for this outage

_breaker = _BreakerState()


# ── Public API ────────────────────────────────────────────────────────────────

def is_configured() -> bool:
    """True when the eCourts token is present. Callers should degrade
    gracefully (return `CourtDataResult(status='unavailable', ...)`) when
    this returns False rather than 503-ing the whole request pipeline."""
    return bool(ECOURTS_TOKEN)


def engine_status() -> dict:
    """Snapshot for /health/ready and admin panels."""
    breaker_open = time.time() < _breaker.open_until_ts
    return {
        "configured": is_configured(),
        "base_url": ECOURTS_BASE,
        "breaker": {
            "open": breaker_open,
            "open_until_ts": _breaker.open_until_ts if breaker_open else 0,
            "consecutive_failures": _breaker.consecutive_failures,
            "trip_after": BREAKER_TRIP_AFTER,
            "cooldown_s": BREAKER_COOLDOWN_S,
        },
        "counters": {"total_ok": _breaker.total_ok, "total_fail": _breaker.total_fail},
        "last_error_id": _breaker.last_error_id,
        "cache": {"ttl_s": CNR_CACHE_TTL_S, **_cache_counters},
    }


async def case_by_cnr(cnr: str) -> CourtDataResult:
    """Look up a case by CNR. Never raises for upstream problems —
    all failures become `CourtDataResult(status='unavailable', ...)`.

    Checks the 24h Mongo cache first (see `_cache_get`) — a repeat lookup of
    the same CNR (e.g. a litigant re-checking their next hearing date) is
    served instantly without touching the eCourts partner API or the circuit
    breaker at all.
    """
    cnr = (cnr or "").strip().upper()
    if not CNR_RE.match(cnr):
        return _bad_input(
            # B-104: DLHC010001232024 was a real, resolvable CNR (returned a
            # real petitioner's full name on eCourts) — swapped for a
            # same-shape, non-resolving example (state code "XX" doesn't
            # exist; year 2099 can't be a real filed case) so a user who
            # types this error message's own example back in never hits a
            # real person's record.
            "CNR must be 4 capital letters followed by 12 digits "
            "(16 chars, e.g. XXHC000000002099).",
        )

    cached = await _cache_get(cnr)
    if cached is not None:
        _cache_counters["hits"] += 1
        return CourtDataResult(status="ok", data=cached, from_cache=True)
    _cache_counters["misses"] += 1

    result = await _fetch(
        f"/api/partner/case/{cnr}",
        params=None,
        normaliser=lambda p: _normalise_case(p.get("data", p), cnr),
        caller=f"case_by_cnr:{cnr[:4]}…",
    )
    if result.is_ok():
        await _cache_put(cnr, result.data)
    return result


async def search_by_party(name: str, page: int = 1) -> CourtDataResult:
    """Search cases by party name. Same failure semantics as `case_by_cnr`."""
    name = (name or "").strip()
    if len(name) < 2:
        return _bad_input("Party name must be at least 2 characters.")
    return await _fetch(
        "/api/partner/search",
        params={"litigants": name, "nameMatchMode": "phrase", "page": page, "pageSize": 20},
        normaliser=lambda p: _normalise_search(p, page),
        caller=f"search:{name[:20]}",
    )


# ── Internals ─────────────────────────────────────────────────────────────────

async def _fetch(
    path: str,
    params: Optional[dict],
    normaliser,
    *,
    caller: str,
) -> CourtDataResult:
    error_id = str(uuid.uuid4())[:8]

    # 1) Config check.
    if not is_configured():
        _log(caller, error_id, "not_configured")
        return CourtDataResult(
            status="unavailable",
            error_id=error_id,
            message=(
                "Court-case lookup is not configured on this server. "
                "Please try again later."
            ),
            http_hint=503,
        )

    # 2) Circuit breaker.
    now = time.time()
    if now < _breaker.open_until_ts:
        remaining = int(_breaker.open_until_ts - now)
        _log(caller, error_id, f"breaker_open_{remaining}s")
        return CourtDataResult(
            status="unavailable",
            error_id=error_id,
            message=(
                "The court-data service is temporarily unavailable. "
                f"Please try again in about {remaining} seconds."
            ),
            http_hint=503,
        )

    headers = {"Authorization": f"Bearer {ECOURTS_TOKEN}", "Accept": "application/json"}

    # 3) Retry loop.
    last_status: Optional[int] = None
    last_detail = ""
    for attempt in range(MAX_RETRIES):
        try:
            t0 = time.time()
            async with httpx.AsyncClient(base_url=ECOURTS_BASE, timeout=TIMEOUT_S) as client:
                r = await client.get(path, params=params, headers=headers)
            last_status = r.status_code

            if r.status_code == 429 and attempt < MAX_RETRIES - 1:
                backoff = 2 ** attempt
                _log(caller, error_id, f"429_retry_{backoff}s", elapsed_ms=int((time.time() - t0) * 1000))
                await asyncio.sleep(backoff)
                continue

            if r.status_code == 404:
                _record_ok()
                _log(caller, error_id, "not_found")
                return CourtDataResult(
                    status="not_found",
                    error_id=error_id,
                    message="No matching case was found.",
                    http_hint=404,
                )

            if r.status_code >= 400:
                try:
                    j = r.json()
                    last_detail = (
                        j.get("message") or j.get("error", {}).get("message", "")
                    )
                except Exception:
                    last_detail = ""
                # Client errors (4xx except 429/404) are not retried; server
                # errors (5xx) fall through to the retry-loop's next iteration.
                if r.status_code < 500:
                    _record_fail()
                    _log(caller, error_id, f"upstream_{r.status_code}")
                    return CourtDataResult(
                        status="unavailable",
                        error_id=error_id,
                        message=last_detail or "The court-data service rejected the request.",
                        http_hint=r.status_code,
                        upstream_status=r.status_code,
                        upstream_detail=last_detail,
                    )
                # 5xx → retry
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                # Fall through to failure below.
                break

            # 2xx OK.
            _record_ok()
            payload = r.json()
            elapsed_ms = int((time.time() - t0) * 1000)
            _log(caller, error_id, "ok", elapsed_ms=elapsed_ms)
            try:
                return CourtDataResult(status="ok", data=normaliser(payload), error_id=error_id)
            except Exception as e:
                # Normaliser bug — do not blame upstream; log and expose a
                # generic "unavailable" so the UI does not crash on a bad shape.
                _log(caller, error_id, f"normaliser_error:{type(e).__name__}")
                return CourtDataResult(
                    status="unavailable",
                    error_id=error_id,
                    message="Received an unexpected response format. Please retry.",
                    http_hint=502,
                )

        except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as e:
            last_detail = f"{type(e).__name__}: {e}"[:200]
            if attempt < MAX_RETRIES - 1:
                _log(caller, error_id, f"transient_retry_{type(e).__name__}")
                await asyncio.sleep(2 ** attempt)
                continue
            break
        except Exception as e:                                              # pragma: no cover
            last_detail = f"{type(e).__name__}: {e}"[:200]
            break

    # All retries exhausted.
    _record_fail()
    _log(caller, error_id, f"exhausted:{last_status}", detail=last_detail)
    return CourtDataResult(
        status="unavailable",
        error_id=error_id,
        message=(
            "The court-data service is not responding right now. "
            f"Please try again in a moment. (ref {error_id})"
        ),
        http_hint=503,
        upstream_status=last_status,
        upstream_detail=last_detail,
    )


def _normalise_case(d: dict, cnr_hint: Optional[str] = None) -> dict:
    """Same shape the router used to return via server.py::_nc()."""
    d = d.get("courtCaseData", d) if isinstance(d, dict) else {}
    return {
        "cnr":               d.get("cnr")             or cnr_hint,
        "case_status":       d.get("caseStatus"),
        "next_hearing_date": d.get("nextHearingDate"),
        "court_name":        d.get("courtName"),
        "district":          d.get("district"),
        "state":             d.get("state"),
        "case_type":         d.get("caseType"),
        "filing_date":       d.get("filingDate"),
        "petitioners":       d.get("petitioners")     or [],
        "respondents":       d.get("respondents")     or [],
    }


def _normalise_search(payload: dict, page: int) -> dict:
    rows = payload.get("data", {}).get("results", []) if isinstance(payload, dict) else []
    if isinstance(rows, dict):
        rows = rows.get("results", [])
    return {"results": [_normalise_case(x) for x in (rows or [])], "page": page}


def _bad_input(msg: str) -> CourtDataResult:
    return CourtDataResult(
        status="invalid",
        error_id=str(uuid.uuid4())[:8],
        message=msg,
        http_hint=400,
    )


def _record_ok() -> None:
    was_open = _breaker.alert_fired
    _breaker.consecutive_failures = 0
    _breaker.open_until_ts = 0
    _breaker.total_ok += 1
    if was_open:
        _breaker.alert_fired = False
        _fire_alert_bg(
            "eCourts service RECOVERED",
            f"The circuit breaker has closed after {_breaker.total_fail} total failures "
            f"this outage. Court-case lookups are flowing normally again.",
            severity="info",
        )


def _record_fail() -> None:
    _breaker.consecutive_failures += 1
    _breaker.total_fail += 1
    if _breaker.consecutive_failures >= BREAKER_TRIP_AFTER:
        _breaker.open_until_ts = time.time() + BREAKER_COOLDOWN_S
        logger.warning(
            "[court_data] circuit breaker OPENED after %d consecutive failures — cooldown %ds",
            _breaker.consecutive_failures, int(BREAKER_COOLDOWN_S),
        )
        if not _breaker.alert_fired:
            _breaker.alert_fired = True
            _fire_alert_bg(
                "eCourts circuit breaker OPENED",
                f"{_breaker.consecutive_failures} consecutive failures against the eCourts "
                f"partner API. Fast-failing for {int(BREAKER_COOLDOWN_S)}s before retrying. "
                f"Last error ref: {_breaker.last_error_id or 'n/a'}.",
                severity="critical",
            )


def _fire_alert_bg(title: str, detail: str, *, severity: str) -> None:
    """Fire-and-forget ops alert — never blocks or raises into the caller."""
    try:
        from services.alerts import send_ops_alert
        loop = asyncio.get_event_loop()
        loop.create_task(send_ops_alert(title, detail, severity=severity))
    except Exception as e:                                              # pragma: no cover
        logger.warning("[court_data] could not schedule ops alert: %s", e)


# ── 24h Mongo cache (CNR lookups only — see case_by_cnr) ──────────────────────

_cache_counters = {"hits": 0, "misses": 0}


def _cache_collection():
    """Lazy import — keeps this module importable (e.g. under pytest) without
    a live Mongo connection unless a cache operation is actually invoked."""
    from dependencies import db
    return db.court_case_cache


async def ensure_cache_indexes() -> None:
    """Call once at app startup. TTL index auto-deletes entries after
    CNR_CACHE_TTL_S seconds — no manual purge job needed. Idempotent."""
    try:
        await _cache_collection().create_index(
            "cached_at", expireAfterSeconds=CNR_CACHE_TTL_S, name="cnr_cache_ttl",
        )
    except Exception as e:
        logger.warning("[court_data] cache index creation warning: %s", e)


async def _cache_get(cnr: str) -> Optional[dict]:
    try:
        doc = await _cache_collection().find_one({"_id": cnr})
    except Exception as e:
        logger.warning("[court_data] cache read failed (degrading to live fetch): %s", e)
        return None
    if not doc:
        return None
    data = dict(doc.get("data") or {})
    data["_cache"] = {"hit": True, "cached_at": doc.get("cached_at")}
    return data


async def _cache_put(cnr: str, data: dict) -> None:
    try:
        await _cache_collection().update_one(
            {"_id": cnr},
            {"$set": {"data": data, "cached_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    except Exception as e:
        # Cache-write failure must never fail the (already successful) lookup.
        logger.warning("[court_data] cache write failed (non-fatal): %s", e)


def _log(caller: str, error_id: str, status: str, *, elapsed_ms: Optional[int] = None, detail: str = "") -> None:
    line = f"[court_data] caller={caller} error_id={error_id} status={status}"
    if elapsed_ms is not None:
        line += f" elapsed_ms={elapsed_ms}"
    if detail:
        line += f" detail={detail[:150]}"
    if _breaker.consecutive_failures:
        line += f" consec_fail={_breaker.consecutive_failures}"
    _breaker.last_error_id = error_id
    if status == "ok" or status == "not_found":
        logger.info(line)
    else:
        logger.warning(line)
