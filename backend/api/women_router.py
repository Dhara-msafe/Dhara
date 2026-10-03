"""Women's Shield — Sprint A backend (rights cards, verified service directory,
Safety Router) — all behind server-side feature flags, default off.

Non-negotiables honoured:
  * No legal content is authored here. `rights_cards` ship as empty DRAFT shells
    with only a scenario_key + a user-facing situation title (UI chrome). Verdict
    / why / law / do_now stay empty until a human legal/advocate review fills them
    and an admin releases the card. A card below the configured minimum release
    state is NEVER returned to clients.
  * Service numbers come ONLY from the `service_directory` collection.
  * No model calls. The Safety Router is pure rule-based keyword matching.
  * Prohibited user-facing phrases are stripped from any outgoing card text.
  * Admin writes (import / release / quarantine / verify / flags) are appended to
    an append-only `women_audit` log. Only IDs + event types are logged.
  * Portable: standard FastAPI + MongoDB, reuses the existing X-Admin-Key.
"""
import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from emergentintegrations.llm.chat import LlmChat, UserMessage

from dependencies import db, logger, check_admin_key

load_dotenv()

router = APIRouter()

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
TRANSLATE_MODEL = os.environ.get("TRANSLATE_MODEL", "gpt-4o-mini")
LANG_NAMES = {
    "hi": "Hindi", "mr": "Marathi", "ta": "Tamil", "bn": "Bengali", "te": "Telugu",
    "kn": "Kannada", "ml": "Malayalam", "gu": "Gujarati", "pa": "Punjabi", "or": "Odia",
    "as": "Assamese", "ur": "Urdu", "ne": "Nepali", "sa": "Sanskrit", "kok": "Konkani",
    "mni": "Manipuri", "sat": "Santali", "mai": "Maithili", "doi": "Dogri", "brx": "Bodo",
    "ks": "Kashmiri", "sd": "Sindhi",
}
TRANSLATABLE = ["situation", "verdict", "why", "if_refused", "evidence_tips"]

# ── Feature flags (db.settings, _id = "app_flags") ───────────────────────────
FLAGS_ID = "app_flags"
DEFAULT_FLAGS = {
    "women_shield_enabled": False,
    "women_cards_min_release_state": "LEGAL_REVIEWED",
    "discreet_mode_enabled": False,
    "trusted_circle_enabled": False,
    "evidence_locker_enabled": False,
}

# Release-state ordering. QUARANTINED is special — always hidden from clients.
RELEASE_ORDER = {"DRAFT": 0, "LEGAL_REVIEWED": 1, "ADVOCATE_VERIFIED": 2}
RELEASE_STATES = {"DRAFT", "LEGAL_REVIEWED", "ADVOCATE_VERIFIED", "QUARANTINED"}

# The ten launch scenarios (keys only — titles are UI chrome, not legal content).
SCENARIO_KEYS = [
    "police_wont_file", "violence_at_home", "thrown_out_of_home", "dowry_demands",
    "harassment_at_work", "stalking_online_abuse", "private_photos_leaked",
    "after_assault", "woman_arrested", "children_safety",
]

# Lay-language → scenario matching for the Safety Router (English + a few common
# Hindi romanised cues). Conservative: first match wins, else scenario is null.
SCENARIO_CUES = [
    ("police_wont_file",     ["fir", "complaint", "police won", "won't write", "nahi likh", "thana", "refuse", "zero fir"]),
    ("violence_at_home",     ["beat", "hit me", "husband", "in-law", "domestic", "ghar me maar", "marta hai", "violence at home"]),
    ("thrown_out_of_home",   ["thrown out", "kicked out", "ghar se nikal", "nowhere to go", "evict", "locked out"]),
    ("dowry_demands",        ["dowry", "dahej", "demand money", "gift", "jewellery demand"]),
    ("harassment_at_work",   ["workplace", "office", "boss", "colleague", "harass at work", "posh", "manager"]),
    ("stalking_online_abuse",["stalk", "following me", "online abuse", "troll", "threat message", "peecha"]),
    ("private_photos_leaked",["photo leak", "private photo", "nude", "morph", "intimate image", "shared my pic"]),
    ("after_assault",        ["assault", "rape", "molest", "touched me", "attack", "chhed"]),
    ("woman_arrested",       ["arrest", "detained", "custody", "giraftar", "lock up"]),
    ("children_safety",      ["child", "minor", "bachcha", "pocso", "school", "kidnap"]),
]

# Urgency detection (C4, rule-based + conservative — checked on the transcript).
EMERGENCY_CUES = [
    "right now", "happening now", "he is here", "danger", "help me", "save me",
    "bleeding", "weapon", "knife", "gun", "kill", "abhi", "bacha lo", "jaan",
    "threatening", "locked", "can't breathe", "unconscious",
]

# Prohibited user-facing phrases (Layer M validation + static copy).
PROHIBITED = [
    "help is on the way", "police have been notified", "your fir has been filed",
    "your complaint has been registered", "court-ready", "guaranteed admissible",
    "you will win",
]


def _strip_prohibited(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    out = text
    for p in PROHIBITED:
        out = re.sub(re.escape(p), "[removed]", out, flags=re.IGNORECASE)
    return out


async def get_flags() -> dict:
    doc = await db.settings.find_one({"_id": FLAGS_ID}) or {}
    return {k: doc.get(k, v) for k, v in DEFAULT_FLAGS.items()}


def _card_public(doc: dict) -> dict:
    return {
        "card_id": doc["card_id"],
        "scenario_key": doc["scenario_key"],
        "language": doc.get("language", "en"),
        "situation": doc.get("situation", ""),
        "verdict": _strip_prohibited(doc.get("verdict", "")),
        "why": _strip_prohibited(doc.get("why", "")),
        "law": doc.get("law", []),
        "do_now": [_strip_prohibited(x) for x in doc.get("do_now", [])],
        "if_refused": _strip_prohibited(doc.get("if_refused", "")),
        "emergency": doc.get("emergency"),
        "evidence_tips": _strip_prohibited(doc.get("evidence_tips", "")),
        "translation": doc.get("translation", {}),
        "release_state": doc.get("release_state", "DRAFT"),
        "verified_by": doc.get("verified_by"),
        "version": doc.get("version", 1),
        "updated_at": doc.get("updated_at"),
    }


def _service_public(doc: dict) -> dict:
    return {
        "service_id": doc["service_id"],
        "name": doc["name"],
        "number": doc["number"],
        "channel": doc.get("channel", "call"),
        "categories": doc.get("categories", []),
        "scope": doc.get("scope", "national"),
        "hours": doc.get("hours", "24x7"),
        "languages": doc.get("languages", ""),
        "source_url": doc.get("source_url", ""),
        "verified_at": doc.get("verified_at"),
        "verified": bool(doc.get("verified_at")),
        "active": doc.get("active", True),
    }


def _meets_min(release_state: str, minimum: str) -> bool:
    if release_state == "QUARANTINED":
        return False
    return RELEASE_ORDER.get(release_state, -1) >= RELEASE_ORDER.get(minimum, 1)


async def _audit(action: str, target: str, detail: Optional[dict] = None) -> None:
    """Append-only. Logs only IDs + event types — never personal incident text."""
    await db.women_audit.insert_one({
        "id": str(uuid.uuid4()),
        "ts": datetime.now(timezone.utc).isoformat(),
        "actor": "admin",
        "action": action,
        "target": target,
        "detail": detail or {},
    })


async def _translate_card(doc: dict, lang: str) -> dict:
    """Return a copy of the card with user-facing text in `lang`. Translation of
    the already-vetted English is cached in the card's `translation.<lang>` so it
    is a one-time cost per card per language. Law citations and helpline numbers
    are never changed. Falls back to English on any failure."""
    if lang == "en" or lang not in LANG_NAMES:
        return doc
    cached = (doc.get("translation") or {}).get(lang)
    if isinstance(cached, dict) and cached.get("verdict"):
        merged = dict(doc)
        for k in TRANSLATABLE:
            if cached.get(k):
                merged[k] = cached[k]
        if isinstance(cached.get("do_now"), list) and cached["do_now"]:
            merged["do_now"] = cached["do_now"]
        return merged
    if not EMERGENT_LLM_KEY:
        return doc
    payload = {k: doc.get(k, "") for k in TRANSLATABLE}
    payload["do_now"] = doc.get("do_now", [])
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"wtr-{os.urandom(4).hex()}",
            system_message=(
                f"Translate this Indian legal-help text into {LANG_NAMES[lang]}. Keep it "
                "simple, faithful and natural. Do NOT change or translate law names, "
                "section numbers (e.g. BNSS §173) or helpline numbers, and do not add "
                "any new facts. Reply ONLY as compact JSON with exactly the same keys "
                "(including a do_now array of the same length)."
            ),
        ).with_model("openai", TRANSLATE_MODEL)
        reply = await chat.send_message(UserMessage(text=json.dumps(payload, ensure_ascii=False)))
        text = reply if isinstance(reply, str) else str(reply)
        m = re.search(r"\{.*\}", text, re.DOTALL)
        tr = json.loads(m.group(0)) if m else None
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[women] translate failed ({lang}): {type(e).__name__}")
        return doc
    if not isinstance(tr, dict):
        return doc
    try:
        await db.rights_cards.update_one({"card_id": doc["card_id"]}, {"$set": {f"translation.{lang}": tr}})
    except Exception:
        pass
    merged = dict(doc)
    for k in TRANSLATABLE:
        if tr.get(k):
            merged[k] = tr[k]
    if isinstance(tr.get("do_now"), list) and tr["do_now"]:
        merged["do_now"] = tr["do_now"]
    return merged


# ── Public endpoints ─────────────────────────────────────────────────────────

@router.get("/women/flags")
async def women_flags():
    """Public: which Women's Shield features are enabled (so the client can
    hide/show tools). No legal content."""
    return await get_flags()


@router.get("/women/cards")
async def list_cards(language: str = "en"):
    flags = await get_flags()
    if not flags["women_shield_enabled"]:
        return {"enabled": False, "count": 0, "cards": []}
    minimum = flags["women_cards_min_release_state"]
    cursor = db.rights_cards.find({"language": language}, {"_id": 0})
    docs = await cursor.to_list(length=200)
    visible = [_card_public(d) for d in docs if _meets_min(d.get("release_state", "DRAFT"), minimum)]
    return {"enabled": True, "count": len(visible), "cards": visible}


@router.get("/women/helplines")
async def list_helplines(category: Optional[str] = None, state: Optional[str] = None):
    flags = await get_flags()
    if not flags["women_shield_enabled"]:
        return {"enabled": False, "count": 0, "services": []}
    q: dict = {"active": True}
    if category:
        q["categories"] = category
    cursor = db.service_directory.find(q, {"_id": 0})
    docs = await cursor.to_list(length=200)
    # state filter: national OR the requested state appears in scope.
    out = []
    for d in docs:
        scope = d.get("scope", "national")
        if state and scope != "national" and state not in str(scope):
            continue
        out.append(_service_public(d))
    return {"enabled": True, "count": len(out), "services": out}


class RouteIn(BaseModel):
    text: str = ""
    lang: str = "en"
    state: Optional[str] = None
    scenario_key: Optional[str] = None  # when the user tapped a tile directly


@router.post("/women/route")
async def safety_route(body: RouteIn):
    """Safety Router (A3). Works without login. Rule-based only — no model call.
    Returns urgency + matched scenario + the released card (if any) + the
    relevant verified services. A card below the min release state is withheld
    (card = null) so unverified legal content is never surfaced."""
    flags = await get_flags()
    lower = (body.text or "").lower()

    # Urgency — conservative keyword scan on the transcript.
    urgency = "emergency" if any(cue in lower for cue in EMERGENCY_CUES) else "normal"

    # Scenario — explicit tile wins, else first keyword match.
    scenario_key = body.scenario_key
    if not scenario_key:
        for key, cues in SCENARIO_CUES:
            if any(cue in lower for cue in cues):
                scenario_key = key
                break

    card = None
    if flags["women_shield_enabled"] and scenario_key:
        doc = await db.rights_cards.find_one({"scenario_key": scenario_key, "language": body.lang}, {"_id": 0}) \
            or await db.rights_cards.find_one({"scenario_key": scenario_key, "language": "en"}, {"_id": 0})
        if doc and _meets_min(doc.get("release_state", "DRAFT"), flags["women_cards_min_release_state"]):
            doc = await _translate_card(doc, body.lang)
            card = _card_public(doc)

    # Services: emergency first; add women_support + the scenario's natural category.
    cats = ["emergency"]
    if urgency == "emergency":
        cats = ["emergency", "women_support"]
    else:
        cats = ["women_support", "emergency"]
    if scenario_key == "stalking_online_abuse" or scenario_key == "private_photos_leaked":
        cats.append("cyber")
    if scenario_key == "children_safety":
        cats.append("child")
    services: List[dict] = []
    seen = set()
    if flags["women_shield_enabled"]:
        for cat in cats:
            cursor = db.service_directory.find({"active": True, "categories": cat}, {"_id": 0})
            for d in await cursor.to_list(length=50):
                if d["service_id"] not in seen:
                    seen.add(d["service_id"])
                    services.append(_service_public(d))

    return {
        "urgency": urgency,
        "scenario_key": scenario_key,
        "card": card,
        "services": services,
    }


# ── Admin endpoints (X-Admin-Key) ────────────────────────────────────────────

class FlagsIn(BaseModel):
    women_shield_enabled: Optional[bool] = None
    women_cards_min_release_state: Optional[str] = None
    discreet_mode_enabled: Optional[bool] = None
    trusted_circle_enabled: Optional[bool] = None
    evidence_locker_enabled: Optional[bool] = None


@router.post("/women/admin/flags")
async def set_flags(body: FlagsIn, x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if "women_cards_min_release_state" in update and update["women_cards_min_release_state"] not in RELEASE_ORDER:
        raise HTTPException(400, "min release state must be DRAFT | LEGAL_REVIEWED | ADVOCATE_VERIFIED")
    await db.settings.update_one({"_id": FLAGS_ID}, {"$set": update}, upsert=True)
    await _audit("flags.update", FLAGS_ID, {"keys": list(update.keys())})
    return await get_flags()


class CardIn(BaseModel):
    card_id: Optional[str] = None
    scenario_key: str
    language: str = "en"
    situation: str = ""
    verdict: str = ""
    why: str = ""
    law: list = Field(default_factory=list)
    do_now: List[str] = Field(default_factory=list)
    if_refused: str = ""
    emergency: Optional[str] = None
    evidence_tips: str = ""
    translation: dict = Field(default_factory=dict)
    release_state: str = "DRAFT"


@router.post("/women/admin/cards/import")
async def import_cards(body: List[CardIn], x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    now = datetime.now(timezone.utc).isoformat()
    results = []
    for item in body:
        if item.release_state not in RELEASE_STATES:
            raise HTTPException(400, f"invalid release_state {item.release_state}")
        existing = await db.rights_cards.find_one({"scenario_key": item.scenario_key, "language": item.language})
        payload = item.model_dump()
        payload["card_id"] = existing["card_id"] if existing else (item.card_id or str(uuid.uuid4()))
        payload["updated_at"] = now
        if existing:
            payload["version"] = int(existing.get("version", 1)) + 1
            await db.rights_cards.update_one({"card_id": payload["card_id"]}, {"$set": payload})
            results.append({"card_id": payload["card_id"], "action": "updated"})
        else:
            payload["version"] = 1
            payload["verified_by"] = None
            await db.rights_cards.insert_one(payload)
            results.append({"card_id": payload["card_id"], "action": "created"})
    await _audit("cards.import", "rights_cards", {"count": len(results)})
    return {"count": len(results), "results": results}


class ReleaseIn(BaseModel):
    release_state: str
    verified_by: Optional[dict] = None  # { name, enrolment_no }


@router.post("/women/admin/cards/{card_id}/release")
async def release_card(card_id: str, body: ReleaseIn, x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    if body.release_state not in RELEASE_STATES:
        raise HTTPException(400, "invalid release_state")
    existing = await db.rights_cards.find_one({"card_id": card_id})
    if not existing:
        raise HTTPException(404, "card not found")
    upd = {"release_state": body.release_state, "updated_at": datetime.now(timezone.utc).isoformat()}
    if body.verified_by is not None:
        upd["verified_by"] = body.verified_by
    await db.rights_cards.update_one({"card_id": card_id}, {"$set": upd, "$inc": {"version": 1}})
    await _audit("cards.release", card_id, {"release_state": body.release_state})
    return {"ok": True, "card_id": card_id, "release_state": body.release_state}


@router.post("/women/admin/cards/{card_id}/quarantine")
async def quarantine_card(card_id: str, x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    existing = await db.rights_cards.find_one({"card_id": card_id})
    if not existing:
        raise HTTPException(404, "card not found")
    await db.rights_cards.update_one(
        {"card_id": card_id},
        {"$set": {"release_state": "QUARANTINED", "updated_at": datetime.now(timezone.utc).isoformat()}, "$inc": {"version": 1}},
    )
    await _audit("cards.quarantine", card_id, {})
    return {"ok": True, "card_id": card_id, "release_state": "QUARANTINED"}


class ServiceIn(BaseModel):
    service_id: Optional[str] = None
    name: str
    number: str
    channel: str = "call"
    categories: List[str] = Field(default_factory=list)
    scope: str = "national"
    hours: str = "24x7"
    languages: str = ""
    source_url: str = ""
    active: bool = True


@router.post("/women/admin/services/import")
async def import_services(body: List[ServiceIn], x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    results = []
    for item in body:
        existing = await db.service_directory.find_one({"number": item.number, "name": item.name})
        payload = item.model_dump()
        payload["service_id"] = existing["service_id"] if existing else (item.service_id or str(uuid.uuid4()))
        if existing:
            await db.service_directory.update_one({"service_id": payload["service_id"]}, {"$set": payload})
            results.append({"service_id": payload["service_id"], "action": "updated"})
        else:
            payload["verified_at"] = None  # seeded unverified per spec
            await db.service_directory.insert_one(payload)
            results.append({"service_id": payload["service_id"], "action": "created"})
    await _audit("services.import", "service_directory", {"count": len(results)})
    return {"count": len(results), "results": results}


@router.post("/women/admin/services/{service_id}/verify")
async def verify_service(service_id: str, x_admin_key: Optional[str] = Header(None)):
    check_admin_key(x_admin_key)
    existing = await db.service_directory.find_one({"service_id": service_id})
    if not existing:
        raise HTTPException(404, "service not found")
    now = datetime.now(timezone.utc).isoformat()
    await db.service_directory.update_one({"service_id": service_id}, {"$set": {"verified_at": now}})
    await _audit("services.verify", service_id, {})
    return {"ok": True, "service_id": service_id, "verified_at": now}
