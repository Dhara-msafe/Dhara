"""Outbound Guard — the single place that decides whether any real external
dispatch (dialler, SMS, password-reset email, push, scheduled reminder, ops
alert, guardian/trusted-circle message, external share) actually leaves the
server, per the active release PROFILE.

Two layered controls:

OUTBOUND_MODE  (global master switch — unchanged, fail-closed)
  "live"      → the master switch is ON; individual channels may still be
                restricted by the active profile below.
  "simulate"  → nothing leaves the server; every attempt is recorded in the
                `qa_outbox` collection of the current database.
  Anything else is treated as "simulate" at call time, and
  validate_outbound_config() refuses to let the server start.

OUTBOUND_PROFILE  (per-channel policy — NEW)
  "internal_qa"    → everything simulated; push/reminders/guardian disabled.
  "closed_testing" → dialler/SMS/reset-email/ops/external-share may go live
                     (user-initiated); push, reminders and guardian disabled.
  "production"      → all channels live.
  When unset it is DERIVED for backward-compatibility: live→production,
  simulate→internal_qa.

Golden rule: the profile can only ever RESTRICT a send, never enable one that
OUTBOUND_MODE has not already allowed. A channel sends for real only when
should_send(channel) is True, i.e. OUTBOUND_MODE=="live" AND the active
profile marks that channel "live".

DEPLOYMENT_ENV  (NEW, 14 Nov 2026 — fail-closed startup guard)
  Required, no default: "preview" or "production". A "preview" process whose
  effective OUTBOUND_PROFILE is anything other than "internal_qa" refuses to
  start — this is what stops a preview ever being left on a live/production
  outbound configuration again.
"""
import os
import uuid
import logging
from datetime import datetime, timezone

logger = logging.getLogger("dhara.outbound_guard")

VALID_MODES = ("live", "simulate")
VALID_PROFILES = ("internal_qa", "closed_testing", "sms_only", "production")
VALID_DEPLOYMENT_ENVS = ("preview", "production")

# ── Channels ─────────────────────────────────────────────────────────────────
DIALLER = "dialler"
SMS = "sms"
RESET_EMAIL = "reset_email"
EMAIL = "email"              # generic transactional email (alias of reset path)
PUSH = "push"
REMINDER = "reminder"
EXTERNAL_SHARE = "external_share"
GUARDIAN = "guardian"
OPS_ALERT = "ops_alert"

CHANNELS = (
    DIALLER, SMS, RESET_EMAIL, EMAIL, PUSH, REMINDER,
    EXTERNAL_SHARE, GUARDIAN, OPS_ALERT,
)

# Decision values
LIVE = "live"
SIMULATE = "simulate"
DISABLED = "disabled"

# ── Policy matrix: (profile, channel) → decision ─────────────────────────────
_POLICY = {
    "internal_qa": {
        DIALLER: SIMULATE, SMS: SIMULATE, RESET_EMAIL: SIMULATE, EMAIL: SIMULATE,
        EXTERNAL_SHARE: SIMULATE, OPS_ALERT: SIMULATE,
        PUSH: DISABLED, REMINDER: DISABLED, GUARDIAN: DISABLED,
    },
    "closed_testing": {
        DIALLER: LIVE, SMS: LIVE, RESET_EMAIL: LIVE, EMAIL: LIVE,
        EXTERNAL_SHARE: LIVE, OPS_ALERT: LIVE,
        PUSH: DISABLED, REMINDER: DISABLED, GUARDIAN: DISABLED,
    },
    # sms_only: real SMS/email/share; calls stay simulated (NF-SAFETY-02).
    "sms_only": {
        DIALLER: SIMULATE, SMS: LIVE, RESET_EMAIL: LIVE, EMAIL: LIVE,
        EXTERNAL_SHARE: LIVE, OPS_ALERT: LIVE,
        PUSH: DISABLED, REMINDER: DISABLED, GUARDIAN: DISABLED,
    },
    "production": {
        DIALLER: LIVE, SMS: LIVE, RESET_EMAIL: LIVE, EMAIL: LIVE,
        EXTERNAL_SHARE: LIVE, OPS_ALERT: LIVE,
        PUSH: LIVE, REMINDER: LIVE, GUARDIAN: LIVE,
    },
}


# ── Pilot allow-list (A32) ───────────────────────────────────────────────────
# A named, owner-approved exception for a supervised pilot: the people running
# the pilot must be able to see a real missed-check-in alert arrive on a
# guardian's phone, while every other account on the same deployment keeps the
# profile's own (blocked) behaviour.
#
# Deliberately narrow:
#   * PUSH only. SMS, the dialler, email and external share are untouched —
#     guardian SMS stays blocked and still waits for DLT registration.
#   * Only the user ids listed in PILOT_ALERT_USER_IDS.
#   * The master switch still wins: OUTBOUND_MODE must be "live".
#   * Only on a real deployment: DEPLOYMENT_ENV must be "production", so a
#     preview can never reach a real phone through this door.
#   * Unset or empty (the default) = nothing changes anywhere.
PILOT_CHANNELS = (PUSH,)
PILOT_LIST_ENV = "PILOT_ALERT_USER_IDS"
PILOT_LIST_MAX = 25


def pilot_user_ids() -> frozenset:
    """User ids on the pilot allow-list. Separated by commas or whitespace."""
    raw = os.environ.get(PILOT_LIST_ENV, "")
    ids = [p.strip() for p in raw.replace(",", " ").split()]
    ids = [i for i in ids if i]
    if len(ids) > PILOT_LIST_MAX:
        logger.warning(
            "[outbound_guard] %s has %d entries; only the first %d are used.",
            PILOT_LIST_ENV, len(ids), PILOT_LIST_MAX,
        )
        ids = ids[:PILOT_LIST_MAX]
    return frozenset(ids)


def pilot_override_active() -> bool:
    """True when the allow-list can let a real push through at all."""
    return (
        outbound_live()
        and os.environ.get("DEPLOYMENT_ENV") == "production"
        and bool(pilot_user_ids())
    )


def should_send_to(channel: str, user_id: str) -> bool:
    """Per-recipient version of should_send(). True when the channel is live
    for everyone, or when this one account is on the pilot allow-list for a
    channel the allow-list covers."""
    if should_send(channel):
        return True
    if channel not in PILOT_CHANNELS or not user_id:
        return False
    if not pilot_override_active():
        return False
    return user_id in pilot_user_ids()


def split_recipients(channel: str, recipients) -> tuple:
    """(allowed, blocked) for a list of user ids, keeping their order."""
    allowed, blocked = [], []
    for uid in recipients:
        (allowed if should_send_to(channel, uid) else blocked).append(uid)
    return allowed, blocked


def outbound_mode() -> str:
    return "live" if os.environ.get("OUTBOUND_MODE") == "live" else "simulate"


def outbound_live() -> bool:
    return outbound_mode() == "live"


def outbound_profile() -> str:
    """Active release profile. Explicit OUTBOUND_PROFILE wins; otherwise derived
    from the master switch for backward-compatibility."""
    raw = os.environ.get("OUTBOUND_PROFILE")
    if raw in VALID_PROFILES:
        return raw
    return "production" if outbound_live() else "internal_qa"


def channel_decision(channel: str) -> str:
    """Return the configured decision ('live'|'simulate'|'disabled') for a
    channel under the active profile — ignoring the master switch."""
    return _POLICY.get(outbound_profile(), _POLICY["internal_qa"]).get(channel, SIMULATE)


def should_send(channel: str) -> bool:
    """True only when a real dispatch on this channel is permitted: the master
    switch is live AND the active profile marks the channel live. The profile
    can only restrict, never enable."""
    return outbound_live() and channel_decision(channel) == LIVE


def channel_effective(channel: str) -> str:
    """What will actually happen for this channel right now: 'live' only if
    should_send is True; otherwise 'disabled' when the profile disables it, else
    'simulate'."""
    if should_send(channel):
        return LIVE
    return DISABLED if channel_decision(channel) == DISABLED else SIMULATE


def policy_snapshot() -> dict:
    """Health/debug snapshot — per-channel effective behaviour. No secrets."""
    return {
        "mode": outbound_mode(),
        "profile": outbound_profile(),
        "channels": {c: channel_effective(c) for c in CHANNELS},
        # A32: counts only — the snapshot is a health endpoint, so it names
        # no account.
        "pilot_allowlist": {
            "active": pilot_override_active(),
            "channels": list(PILOT_CHANNELS),
            "count": len(pilot_user_ids()),
        },
    }


def validate_outbound_config() -> str:
    raw = os.environ.get("OUTBOUND_MODE")
    if raw not in VALID_MODES:
        raise RuntimeError(
            "OUTBOUND_MODE must be set explicitly to 'live' or 'simulate' "
            f"(got {raw!r}). Refusing to start."
        )
    prof_raw = os.environ.get("OUTBOUND_PROFILE")
    if prof_raw is not None and prof_raw not in VALID_PROFILES:
        raise RuntimeError(
            "OUTBOUND_PROFILE, when set, must be one of "
            f"{VALID_PROFILES} (got {prof_raw!r}). Refusing to start."
        )

    # NF-SAFETY-01 (14 Nov 2026): which environment is this process running in?
    # No default on purpose — a missing value is exactly the kind of mistake
    # this check exists to catch (a preview accidentally left on a production
    # outbound profile, as happened before this date).
    deployment_env = os.environ.get("DEPLOYMENT_ENV")
    if deployment_env not in VALID_DEPLOYMENT_ENVS:
        raise RuntimeError(
            "DEPLOYMENT_ENV must be set explicitly to 'preview' or 'production' "
            f"(got {deployment_env!r}). Refusing to start."
        )
    if deployment_env == "preview" and outbound_profile() != "internal_qa":
        raise RuntimeError(
            "DEPLOYMENT_ENV=preview requires an effective OUTBOUND_PROFILE of "
            f"'internal_qa' (resolved to {outbound_profile()!r} from "
            f"OUTBOUND_MODE={raw!r} / OUTBOUND_PROFILE={prof_raw!r}). A preview "
            "environment must never be configured to dispatch real outbound "
            "messages. Refusing to start."
        )

    # Explicit production requires a coherent, complete configuration.
    if prof_raw == "production":
        if raw != "live":
            raise RuntimeError(
                "OUTBOUND_PROFILE=production requires OUTBOUND_MODE=live "
                f"(got {raw!r}) — contradictory config. Refusing to start."
            )
        if not (os.environ.get("EMERGENT_EMAIL_KEY") or "").strip():
            raise RuntimeError(
                "OUTBOUND_PROFILE=production requires EMERGENT_EMAIL_KEY to be "
                "configured. Refusing to start."
            )
    if prof_raw == "closed_testing" and raw != "live":
        logger.warning(
            "[outbound_guard] profile=closed_testing but OUTBOUND_MODE=%s — "
            "enabled channels will still SIMULATE until the master switch is live.",
            raw,
        )
    # A32: say plainly at startup whether the pilot allow-list is doing
    # anything, so nobody has to guess why a push did or did not arrive.
    # Counts only — never the account ids.
    pilot_n = len(pilot_user_ids())
    if pilot_n:
        if pilot_override_active():
            logger.warning(
                "[outbound_guard] pilot allow-list ACTIVE for %d account(s) on %s "
                "— every other account keeps the profile's behaviour.",
                pilot_n, ",".join(PILOT_CHANNELS),
            )
        else:
            logger.warning(
                "[outbound_guard] %s lists %d account(s) but has NO effect "
                "(needs OUTBOUND_MODE=live and DEPLOYMENT_ENV=production; "
                "mode=%s env=%s).",
                PILOT_LIST_ENV, pilot_n, raw, os.environ.get("DEPLOYMENT_ENV"),
            )
    logger.warning(
        "[outbound_guard] OUTBOUND_MODE=%s profile=%s", raw, outbound_profile()
    )
    return raw


def is_awareness_updates_consented(user: dict) -> bool:
    """Return True only when this user has explicitly opted in to receiving
    legal-awareness and update messages (consent_purposes.updates == True).

    B-CONSENT-GUARD (v2.2.1): Call this BEFORE dispatching any proactive
    awareness or marketing SMS/WhatsApp message to this user.  A channel being
    live at the deployment level (see should_send) does NOT imply the user
    wants awareness messages — they must opt in separately via the
    'updates' consent purpose.

    EXEMPT — do NOT call this guard for:
      • Safety notifications (missed check-in, journey alerts, emergency) —
        these are user-initiated, safety-essential features, not marketing.
      • Transactional messages (invitation push, password reset, verification) —
        these are operational messages the user expects as part of normal use.

    REQUIRED for:
      • Any proactive legal tip, awareness bulletin, or update SMS/WhatsApp
        message sent without the user's explicit, real-time initiation.

    Returns False (deny) when the user record is None, the purposes field is
    absent, or the 'updates' key is explicitly False or not set.  Fails closed.
    """
    purposes = (user or {}).get("consent_purposes") or {}
    return bool(purposes.get("updates"))


async def record_simulated(kind: str, target: str, payload: dict) -> str:
    """Store a simulated / disabled dispatch in the current DB. Never raises."""
    sim_id = f"simulated-{uuid.uuid4()}"
    try:
        from dependencies import db
        await db.qa_outbox.insert_one({
            "id": sim_id,
            "kind": kind,
            "target": target,
            "payload": payload,
            "profile": outbound_profile(),
            "decision": channel_effective(kind) if kind in _POLICY["production"] else SIMULATE,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:  # recording must never turn into a real send
        logger.warning("[outbound_guard] could not record simulated %s: %s", kind, e)
    logger.info("[outbound_guard] SIMULATED %s → %s (nothing sent)", kind, target)
    return sim_id
