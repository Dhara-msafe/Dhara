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

try:
    from push import send_push
except Exception:   # pragma: no cover — push relay optional in some envs
    async def send_push(*a, **kw):  # type: ignore
        return None

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
        # Owner's "If I don't respond" choice, set at journey creation (circle.tsx).
        # Default True preserves the original always-notify behaviour for journeys
        # created before this field existed (missing key -> True, not False).
        if not rec.get("auto_notify_on_no_response", True):
            logger.info(
                "[deadline] journey %s missed its check-in but owner opted out of "
                "auto-notify — circle not alerted", journey_token,
            )
            count += 1
            continue

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


async def _run_reminders(db) -> int:
    """Single scan pass for the OWNER's own "remind me before alerting" setting
    (distinct from the missed-checkin circle-notification pass above — this
    never touches the trusted circle, only pings the traveller themselves).

    Fires once per journey, `remind_before_mins` minutes ahead of
    expected_checkin_at, strictly before that deadline passes — a journey
    already past its deadline is left to the missed-checkin pass instead.
    """
    now = datetime.now(timezone.utc)

    cursor = db.safety_journeys.find({
        "status":                "in_progress",
        "sharing_revoked_at":    None,
        "reminder_sent_at":      None,
        "remind_before_mins":    {"$ne": None},
    })

    count = 0
    async for rec in cursor:
        journey_token = rec.get("token")
        remind_before = rec.get("remind_before_mins")
        try:
            expected_at = datetime.fromisoformat(rec["expected_checkin_at"])
        except Exception:
            continue
        remind_at = expected_at - timedelta(minutes=remind_before)
        if now < remind_at or now >= expected_at:
            continue   # not yet time, or already past the deadline

        # Atomic guard — same claim-before-send pattern as the missed-checkin pass.
        result = await db.safety_journeys.update_one(
            {"token": journey_token, "reminder_sent_at": None},
            {"$set": {"reminder_sent_at": now.isoformat()}},
        )
        if result.modified_count == 0:
            continue

        try:
            await send_push(
                recipients=[rec["user_id"]],
                data={
                    "title": "Check-in coming up",
                    "message": (
                        f"Your DHARA check-in for \"{rec.get('destination', 'your trip')}\" "
                        f"is in {remind_before} minutes. Open the app to confirm you're safe "
                        f"or extend your journey."
                    ),
                    "action_url": "/women/head-out",
                },
                idempotency_key=f"{journey_token}:reminder",
            )
            logger.info("[deadline] reminder sent for journey %s", journey_token)
        except Exception as exc:
            logger.warning("[deadline] reminder push failed for journey %s: %s", journey_token, exc)

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
        try:
            r = await _run_reminders(db)
            if r:
                logger.info("[deadline] reminder scan complete: reminded %d journey(s)", r)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("[deadline] unexpected reminder scan error: %s", exc)
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