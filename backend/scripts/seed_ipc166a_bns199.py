"""
P1 grounding fix — seed verified legal_sections records for IPC Section 166A
and BNS Section 199 (preview/test database only).

Root cause this fixes: the chat engine's exact-statute path only answers from
`db.legal_sections`; with no document there for either section, the LLM had
no verified grounding and produced a wrong, hallucinated punishment ("up to
one year, or fine, or both" — the actual text of the ADJACENT, unrelated
IPC Section 166 — a nearby-identifier mix-up).

Text sourced from the Criminal Law (Amendment) Act, 2013 (IPC 166A) and the
Bharatiya Nyaya Sanhita, 2023 (BNS 199), cross-checked against two
independent sources. This is the complete provision (elements, cross-
references, punishment) — not a summary. Idempotent: uses an upsert keyed on
(act_name, section_number) with $setOnInsert, so re-running this script never
overwrites an existing record (verified or otherwise) and never duplicates.

Usage: python3 scripts/seed_ipc166a_bns199.py
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

IPC_166A_TEXT = (
    "166A. Public servant disobeying direction under law.\u2014Whoever, being a public "
    "servant,\u2014\n"
    "(a) knowingly disobeys any direction of the law which prohibits him from requiring the "
    "attendance at any place of any person for the purpose of investigation into an offence or "
    "any other matter, or\n"
    "(b) knowingly disobeys, to the prejudice of any person, any other direction of the law "
    "regulating the manner in which he shall conduct such investigation, or\n"
    "(c) fails to record any information given to him under sub-section (1) of section 154 of "
    "the Code of Criminal Procedure, 1973, in relation to cognizable offence punishable under "
    "section 326A, 326B, 354, 354B, 370, 370A, 376, 376A, 376B, 376C, 376D, 376E or 509,\n"
    "shall be punished with rigorous imprisonment for a term which shall not be less than six "
    "months but which may extend to two years, and shall also be liable to fine."
)

BNS_199_TEXT = (
    "199. Public servant disobeying direction under law.\u2014Whoever, being a public "
    "servant,\u2014\n"
    "(a) knowingly disobeys any direction of the law which prohibits him from requiring the "
    "attendance at any place of any person for the purpose of investigation into an offence or "
    "any other matter, or\n"
    "(b) knowingly disobeys, to the prejudice of any person, any other direction of the law "
    "regulating the manner in which he shall conduct such investigation, or\n"
    "(c) fails to record any information given to him under sub-section (1) of section 173 of "
    "the Bharatiya Nagarik Suraksha Sanhita, 2023, in relation to cognizable offence punishable "
    "under section 64, 65, 66, 67, 68, 70, 71, 74, 76, 77, 79, 124, 143 or 144,\n"
    "shall be punished with rigorous imprisonment for a term which shall not be less than six "
    "months but which may extend to two years, and shall also be liable to fine."
)

DOCS = [
    {
        "act_name": "Indian Penal Code",
        "section_number": "166A",
        "section_heading": "Public servant disobeying direction under law",
        "section_text": IPC_166A_TEXT,
        "jurisdiction": "CENTRAL",
        "act_id": "ipc",
        "act_year": 1860,
        "source_url": "https://www.indiacode.gov.in/handle/123456789/2263",
        "verify_tier": 2,
        "is_dead_law": True,
        "dead_law_reason": (
            "Indian Penal Code, 1860 repealed and replaced by the Bharatiya Nyaya Sanhita, 2023, "
            "effective 1 July 2024. Retained here for historical reference only."
        ),
        "successor_act": "Bharatiya Nyaya Sanhita, Section 199",
        "seeded_by": "p1_grounding_fix_2026-06",
        "seeded_at": datetime.now(timezone.utc).isoformat(),
    },
    {
        "act_name": "Bharatiya Nyaya Sanhita",
        "section_number": "199",
        "section_heading": "Public servant disobeying direction under law",
        "section_text": BNS_199_TEXT,
        "jurisdiction": "CENTRAL",
        "act_id": "bns",
        "act_year": 2023,
        "source_url": "https://www.indiacode.gov.in/handle/123456789/45168",
        "verify_tier": 2,
        "is_dead_law": False,
        "seeded_by": "p1_grounding_fix_2026-06",
        "seeded_at": datetime.now(timezone.utc).isoformat(),
    },
]


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    # Bug fix: the chat engine's exact-statute lookup (corpus_db.py) reads
    # from CORPUS_DB_NAME (the dedicated legal corpus database), never from
    # the app's own DB_NAME. Seeding into DB_NAME silently created records
    # the retrieval pipeline could never see.
    db = client[os.environ["CORPUS_DB_NAME"]]
    for doc in DOCS:
        filt = {"act_name": doc["act_name"], "section_number": doc["section_number"]}
        existing = await db.legal_sections.find_one(filt)
        if existing:
            print(f"SKIP (already present, not overwritten): {doc['act_name']} {doc['section_number']}")
            continue
        res = await db.legal_sections.update_one(filt, {"$setOnInsert": doc}, upsert=True)
        print(f"INSERTED: {doc['act_name']} {doc['section_number']} (upserted_id={res.upserted_id})")


if __name__ == "__main__":
    asyncio.run(main())
