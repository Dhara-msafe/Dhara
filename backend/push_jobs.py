"""
Scheduled push jobs — runs once every 24h inside the backend process (same
pattern as corpus_migration's startup background task; no external
scheduler/cron dependency needed at this user scale).

Two jobs, both best-effort (a failure in one never blocks the other, and
neither ever raises into the caller):

1. Daily re-engagement nudge — free-tier users who have not sent a single
   query yet today get a reminder they still have free questions available.
2. Dead-law bookmark sweep — re-checks every saved answer's cited sections
   against the corpus's CURRENT is_dead_law status. If a section a user
   bookmarked has since been struck down / flagged dead, they get notified
   once (the bookmark's stored citation is updated in place so the same
   flip is never re-notified).
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta

from push import send_push

logger = logging.getLogger("push_jobs")

# Fixed daily run time (UTC). 12:00 UTC = 17:30 IST — a reasonable evening
# reminder slot for an India-focused audience without being a late-night ping.
RUN_HOUR_UTC = 12


def _seconds_until_next_run() -> float:
    now = datetime.now(timezone.utc)
    target = now.replace(hour=RUN_HOUR_UTC, minute=0, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    return (target - now).total_seconds()


async def _already_ran_today(db, job: str, day: str) -> bool:
    existing = await db.push_job_runs.find_one({"job": job, "day": day})
    return existing is not None


async def _mark_ran(db, job: str, day: str) -> None:
    await db.push_job_runs.update_one(
        {"job": job, "day": day}, {"$set": {"ran_at": datetime.now(timezone.utc).isoformat()}}, upsert=True
    )


async def _run_daily_nudge(db) -> None:
    from services.outbound_guard import should_send, REMINDER
    if not should_send(REMINDER):
        logger.info("[push_jobs] daily_nudge skipped — reminders not enabled for this profile/mode")
        return
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if await _already_ran_today(db, "daily_nudge", day):
        return
    try:
        active_ids = set()
        async for doc in db.usage_daily.find({"scope": "user", "kind": "query", "day": day}, {"user_id": 1}):
            active_ids.add(doc.get("user_id"))

        recipients = []
        async for u in db.users.find({"is_pro": {"$ne": True}}, {"id": 1}):
            uid = u.get("id")
            if uid and uid not in active_ids:
                recipients.append(uid)

        if recipients:
            await send_push(
                recipients=recipients,
                data={
                    "title": "Dhara",
                    "message": "You still have free questions today — ask Dhara about any legal issue in your language.",
                    "action_url": "/(tabs)",
                },
                idempotency_key=f"daily_nudge:{day}",
            )
        logger.info(f"[push_jobs] daily_nudge sent to {len(recipients)} user(s) for {day}")
    except Exception as e:
        logger.warning(f"[push_jobs] daily_nudge failed (non-blocking): {type(e).__name__}: {e}")
    finally:
        # Mark done regardless of send outcome — a provider hiccup should not
        # cause a burst of retries; tomorrow's run will simply try again.
        await _mark_ran(db, "daily_nudge", day)


async def _run_dead_law_sweep(db, corpus_db) -> None:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if await _already_ran_today(db, "dead_law_sweep", day):
        return
    notified = 0
    try:
        cursor = db.bookmarks.find({"deleted": {"$ne": True}})
        async for bm in cursor:
            citations = bm.get("citations") or []
            if not citations:
                continue
            changed = False
            newly_dead_label = None
            for c in citations:
                act_name = c.get("act_name")
                section_number = c.get("section_number")
                # Only MongoDB-sourced citations carry these fields + a live
                # is_dead_law status; hand-curated Python-corpus citations
                # (key/citation/short_label shape) have nothing to re-check.
                if not act_name or not section_number or c.get("is_dead_law"):
                    continue
                current = await corpus_db.legal_sections.find_one(
                    {"act_name": act_name, "section_number": section_number},
                    {"is_dead_law": 1, "dead_law_reason": 1},
                )
                if current and current.get("is_dead_law"):
                    c["is_dead_law"] = True
                    c["dead_law_reason"] = current.get("dead_law_reason")
                    changed = True
                    newly_dead_label = c.get("short_label") or act_name

            if changed:
                await db.bookmarks.update_one({"_id": bm["_id"]}, {"$set": {"citations": citations}})
                try:
                    await send_push(
                        recipients=[bm["user_id"]],
                        data={
                            "title": "A law you saved has changed",
                            "message": f"{newly_dead_label} has since been struck down / flagged invalid. Open your saved answer for details.",
                            "action_url": "/(tabs)/saved",
                        },
                        idempotency_key=f"deadlaw:{bm.get('id') or bm['_id']}",
                    )
                    notified += 1
                except Exception as e:
                    logger.warning(f"[push_jobs] dead_law push failed for bookmark {bm.get('id')}: {type(e).__name__}: {e}")
        logger.info(f"[push_jobs] dead_law_sweep notified {notified} bookmark(s) for {day}")
    except Exception as e:
        logger.warning(f"[push_jobs] dead_law_sweep failed (non-blocking): {type(e).__name__}: {e}")
    finally:
        await _mark_ran(db, "dead_law_sweep", day)


async def run_push_jobs_loop(db, corpus_db) -> None:
    """Background task started once at app startup (see server.py). Sleeps
    until the next RUN_HOUR_UTC, runs both jobs, then loops forever. Each job
    is independently idempotent per day, so a mid-run restart just resumes
    cleanly on the next tick rather than double-sending."""
    while True:
        try:
            await asyncio.sleep(_seconds_until_next_run())
            await _run_daily_nudge(db)
            await _run_dead_law_sweep(db, corpus_db)
        except Exception as e:
            logger.warning(f"[push_jobs] loop iteration failed (non-blocking): {type(e).__name__}: {e}")
            # Avoid a tight crash-loop if something above is unexpectedly broken.
            await asyncio.sleep(3600)
