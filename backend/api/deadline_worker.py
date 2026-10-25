"""
deadline_worker.py — F1: Server-side missed check-in deadline enforcement.

Background asyncio task that runs every 2 minutes inside the FastAPI process.

For each in-progress journey where expected_checkin_at + 5-min grace has elapsed
and missed_checkin_notified_at is not yet set, the worker creates one
missed_checkin alert per eligible accepted Trusted Circle recipient.

Key invariants
--------------
* Heartbeats do NOT affect the check-in deadline.  last_heartbeat_at is stored
  for diagnostics only; this worker never reads it.
* One notification per journey, ever.  An atomic $set on
  missed_checkin_notified_at BEFORE sending alerts guards against concurrent
  runs or a fast-restarting process producing duplicates.
* Revoked (sharing_revoked_at set) or safe journeys are excluded by the DB
  query; they are never processed.
* No live HTTP, no SMS, no push calls are made here.  Side effects are limited
  to in-app DB writes via create_alert_and_notify.
* start(db) / stop() are the only public API; everything else is internal.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger("deadline_worker")

_GRACE_MINUTES: int = 5
_SCAN_SECONDS:  int = 120   # 2-minute poll interval

_task: Optional[asyncio.Task] = None   # module-level handle; start() is idempotent


async def _run_once(db) -> int:
    """Single scan pass.  Returns the number of journeys for which missed-checkin
    alerts were created this run (0 most of the time)."""
    now     = datetime.now(timezone.utc)
    cutoff  = (now - timedelta(minutes=_GRACE_MINUTES)).isoformat()

    # Find every open, unrevoked, unnotified journey past its deadline+grace window.
    # The ISO-8601 string comparison works correctly because all timestamps are
    # stored as UTC ISO-8601 (datetime.isoformat()) without fractional seconds.
    cursor = db.safety_journeys.find({
        "status":                     "in_progress",
        "sharing_revoked_at":         None,
        "missed_checkin_notified_at": None,
        "expected_checkin_at":        {"$lt": cutoff},
    })

    count = 0
    async for rec in cursor:
        journey_token = rec.get("token")
        owner_id      = rec.get("user_id")

        # Atomic guard: claim this journey BEFORE sending any alerts.
        # modified_count == 0 ⇒ another concurrent run already claimed it.
        result = await db.safety_journeys.update_one(
            {"token": journey_token, "missed_checkin_notified_at": None},
            {"$set": {"missed_checkin_notified_at": now.isoformat()}},
        )
        if result.modified_count == 0:
            logger.debug("[deadline] journey %s already claimed — skipping", journey_token)
            continue

        # Resolve the owner for alert attribution.
        owner = await db.users.find_one(
            {"id": owner_id}, {"_id": 0, "id": 1, "name": 1}
        )
        if not owner:
            logger.warning(
                "[deadline] owner not found for journey %s — alerts skipped", journey_token
            )
            continue

        # Reuse the same fan-out function used by report_missed_checkin and
        # mark_safe.  Deferred import breaks the potential circular import
        # chain (server.py → deadline_worker → journey_router → server-level
        # objects) that would occur at module load time.
        try:
            from api.journey_router import _notify_linked_recipients  # noqa: PLC0415
            pseudo_user = {"id": owner_id, "name": owner.get("name") or "A DHARA user"}
            await _notify_linked_recipients(pseudo_user, rec, "missed_checkin")
            logger.info(
                "[deadline] missed-checkin alerts sent for journey %s", journey_token
            )
        except Exception as exc:
            logger.error(
                "[deadline] fan-out failed for journey %s: %s", journey_token, exc
            )

        count += 1

    return count


async def _loop(db) -> None:
    """Long-running coroutine: calls _run_once every _SCAN_SECONDS until cancelled."""
    logger.info(
        "[deadline] worker started — scan_interval=%ds grace_period=%dmin",
        _SCAN_SECONDS, _GRACE_MINUTES,
    )
    while True:
        try:
            n = await _run_once(db)
            if n:
                logger.info("[deadline] scan complete: notified %d journey(s)", n)
        except asyncio.CancelledError:
            raise          # propagate so the task terminates cleanly
        except Exception as exc:
            logger.error("[deadline] unexpected scan error: %s", exc)
        await asyncio.sleep(_SCAN_SECONDS)


def start(db) -> None:
    """Schedule the worker as a background asyncio task.

    Idempotent — safe to call more than once (only one task runs at a time).
    Must be called from inside a running event loop (e.g. FastAPI startup hook).
    """
    global _task
    if _task and not _task.done():
        return
    _task = asyncio.ensure_future(_loop(db))
    logger.info("[deadline] worker task scheduled")


async def stop() -> None:
    """Cancel the worker and await its clean shutdown.
    Call from the FastAPI shutdown hook.
    """
    global _task
    if _task and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    logger.info("[deadline] worker stopped")
