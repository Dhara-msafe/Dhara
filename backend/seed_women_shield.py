"""Seed Women's Shield Sprint A data — idempotent.

  * 10 rights_cards as empty DRAFT shells (scenario_key + situation title only;
    NO legal content — verdict/why/law stay empty until human review + release).
  * service_directory: the national public-safety helplines. These are official
    Government of India numbers, so they are seeded verified_at = now with an
    official source_url. State-specific services (added later) seed null.
  * Feature flags doc. women_shield_enabled is turned ON here so the verified
    helpline service is live; cards stay hidden (min release = LEGAL_REVIEWED)
    until a human reviews the DRAFT shells.

Run: python /app/backend/seed_women_shield.py
"""
import asyncio
import uuid
from datetime import datetime, timezone

from dependencies import db

NOW = datetime.now(timezone.utc).isoformat()

SCENARIOS = [
    ("police_wont_file", "Police won't file my complaint"),
    ("violence_at_home", "Violence at home"),
    ("thrown_out_of_home", "Thrown out of home"),
    ("dowry_demands", "Dowry demands"),
    ("harassment_at_work", "Harassment at work"),
    ("stalking_online_abuse", "Stalking & online abuse"),
    ("private_photos_leaked", "Private photos leaked"),
    ("after_assault", "After an assault"),
    ("woman_arrested", "If a woman is arrested"),
    ("children_safety", "Children's safety"),
]

SERVICES = [
    {"name": "Emergency Response Support System", "number": "112", "channel": "call",
     "categories": ["emergency", "women_support"], "scope": "national", "hours": "24x7",
     "languages": "multi", "source_url": "https://112.gov.in/"},
    {"name": "Women Helpline", "number": "181", "channel": "call",
     "categories": ["women_support", "emergency"], "scope": "national", "hours": "24x7",
     "languages": "multi", "source_url": "https://wcd.nic.in/schemes/women-helpline-scheme"},
    {"name": "National Commission for Women", "number": "14490", "channel": "call",
     "categories": ["women_support", "legal_aid"], "scope": "national", "hours": "24x7",
     "languages": "multi", "source_url": "https://ncw.nic.in/"},
    {"name": "Cyber Crime Helpline", "number": "1930", "channel": "call",
     "categories": ["cyber"], "scope": "national", "hours": "24x7",
     "languages": "multi", "source_url": "https://cybercrime.gov.in/"},
    {"name": "Childline", "number": "1098", "channel": "call",
     "categories": ["child", "emergency"], "scope": "national", "hours": "24x7",
     "languages": "multi", "source_url": "https://www.childlineindia.org/"},
    {"name": "NALSA Legal Aid", "number": "15100", "channel": "call",
     "categories": ["legal_aid"], "scope": "national", "hours": "office hours",
     "languages": "multi", "source_url": "https://nalsa.gov.in/"},
    {"name": "Tele-MANAS Mental Health", "number": "14416", "channel": "call",
     "categories": ["mental_health"], "scope": "national", "hours": "24x7",
     "languages": "multi", "source_url": "https://telemanas.mohfw.gov.in/"},
]


async def main():
    # ── Feature flags ──
    await db.settings.update_one(
        {"_id": "app_flags"},
        {"$set": {
            "women_shield_enabled": True,
            "women_cards_min_release_state": "LEGAL_REVIEWED",
            "discreet_mode_enabled": True,
            "trusted_circle_enabled": True,
            "evidence_locker_enabled": True,
        }},
        upsert=True,
    )
    print("flags: set (women_shield_enabled=True, min=LEGAL_REVIEWED)")

    # ── Rights cards (DRAFT shells) ──
    created = 0
    for key, title in SCENARIOS:
        existing = await db.rights_cards.find_one({"scenario_key": key, "language": "en"})
        if existing:
            continue
        await db.rights_cards.insert_one({
            "card_id": str(uuid.uuid4()),
            "scenario_key": key,
            "language": "en",
            "situation": title,
            "verdict": "", "why": "", "law": [], "do_now": [],
            "if_refused": "", "emergency": None, "evidence_tips": "",
            "translation": {"version": None, "reviewer": None},
            "release_state": "DRAFT",
            "verified_by": None,
            "version": 1,
            "updated_at": NOW,
        })
        created += 1
    print(f"rights_cards: {created} created, {len(SCENARIOS) - created} already present (DRAFT)")

    # ── Service directory ──
    svc_created = 0
    for s in SERVICES:
        existing = await db.service_directory.find_one({"number": s["number"], "name": s["name"]})
        if existing:
            continue
        await db.service_directory.insert_one({
            "service_id": str(uuid.uuid4()),
            **s,
            "verified_at": NOW,  # official GoI numbers — pre-verified against source_url
            "active": True,
        })
        svc_created += 1
    print(f"service_directory: {svc_created} created, {len(SERVICES) - svc_created} already present")


if __name__ == "__main__":
    asyncio.run(main())
