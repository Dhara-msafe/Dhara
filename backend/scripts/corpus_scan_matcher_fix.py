"""Corpus scan — Matcher Fix validation.

Connects to MongoDB, enumerates every distinct act_name value from
legal_sections (the 70k-provision corpus), and reports:
  - Total unique act names
  - How many MATCH the registry after the whole-word / year-aware fix
  - How many are NOT_IN_REGISTRY
  - Which acts are correctly rejected now (were false-positives under
    the old substring scan)

Also reports why logs showed 0 NOT_IN_REGISTRY hits on live chat.

Run from the backend directory:
    cd /app/backend && python scripts/corpus_scan_matcher_fix.py
"""
from __future__ import annotations
import os
import sys
import re
import asyncio
from pathlib import Path
from collections import Counter, defaultdict

# ── Bootstrap path so engine modules are importable ──────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

import motor.motor_asyncio

# ── Import the NEW matcher functions directly ─────────────────────────────────
from engine.law_status_guard import (
    _match_provision_to_registry,
    _load_registry,
    _ALIASES,
    _ALIAS_CANONICAL_YEARS,
    _YEAR_RE,
    _is_whole_word_match,
    check_provision,
)

_MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
_DB_NAME   = "bns-know-your-rights-gandhikar_db"

# ── Old substring matcher (pure reimplementation for comparison) ──────────────
def _old_match(act_name_raw: str) -> str | None:
    """Returns the act_id that the OLD substring scan would produce, or None."""
    act_name = act_name_raw.upper().strip()
    for alias, act_id in _ALIASES.items():
        if alias in act_name:
            return act_id.upper()
    return None

# ── New matcher wrapper ───────────────────────────────────────────────────────
def _new_match(act_name_raw: str) -> str | None:
    """Returns act_id from the NEW whole-word / year-aware matcher, or None."""
    prov = {"act_name": act_name_raw}
    # Clear lru_cache so we get a fresh hit each time (registry already loaded)
    rec = _match_provision_to_registry(prov)
    return rec.act_id.upper() if rec else None

async def main() -> None:
    client = motor.motor_asyncio.AsyncIOMotorClient(_MONGO_URL)
    db = client[_DB_NAME]

    # ── 1. Fetch all distinct act_name values from legal_sections ─────────────
    print("\n[1] Fetching distinct act_name values from legal_sections …", flush=True)
    pipeline = [
        {"$group": {"_id": "$act_name"}},
        {"$project": {"act_name": "$_id", "_id": 0}},
    ]
    cursor = db.legal_sections.aggregate(pipeline, allowDiskUse=True)
    all_act_names: list[str] = []
    async for doc in cursor:
        val = doc.get("act_name") or ""
        if val.strip():
            all_act_names.append(val.strip())

    total = len(all_act_names)
    print(f"    → {total} distinct act names found in corpus", flush=True)

    # ── 2. Compare OLD vs NEW for every act name ──────────────────────────────
    _load_registry.cache_clear()
    _load_registry()  # warm cache once

    old_matched = 0
    new_matched = 0
    false_positives_eliminated: list[tuple[str, str, str]] = []  # (act_name, old_id, "→ NOT_IN_REGISTRY")
    new_true_match_examples: list[tuple[str, str]] = []          # (act_name, new_id)
    not_in_registry_names: list[str] = []

    # Short-alias map (≤4 chars) to monitor
    short_aliases = {k: v for k, v in _ALIASES.items() if len(k) <= 4}
    short_alias_old_hits: dict[str, list[str]] = defaultdict(list)  # alias → [act_name, ...]

    for act_name in all_act_names:
        old_id = _old_match(act_name)
        new_id = _new_match(act_name)

        if old_id:
            old_matched += 1
            # Track which short alias triggered it
            act_upper = act_name.upper()
            for alias in short_aliases:
                if alias in act_upper:
                    short_alias_old_hits[alias].append(act_name)

        if new_id:
            new_matched += 1
            if len(new_true_match_examples) < 15:
                new_true_match_examples.append((act_name, new_id))
        else:
            not_in_registry_names.append(act_name)

        # False positive eliminated: old matched, new doesn't
        if old_id and not new_id:
            false_positives_eliminated.append((act_name, old_id, "→ NOT_IN_REGISTRY"))

    # ── 3. Short-alias analysis (≤4 chars) ────────────────────────────────────
    print("\n[2] Short alias (≤4 chars) corpus hits — OLD substring vs NEW whole-word", flush=True)
    for alias, act_id in sorted(short_aliases.items()):
        old_hits = short_alias_old_hits.get(alias, [])
        # New hits: re-run for this alias only
        new_hits = [n for n in all_act_names if _is_whole_word_match(alias, n.upper())]
        print(f"    alias={alias!r:6s} → {act_id!r}  "
              f"old_hits={len(old_hits):4d}  new_hits={len(new_hits):4d}  "
              f"eliminated={len(old_hits)-len(new_hits):4d}", flush=True)
        if len(old_hits) > len(new_hits):
            # Show up to 5 eliminated examples
            eliminated = [h for h in old_hits if not _is_whole_word_match(alias, h.upper())]
            for ex in eliminated[:5]:
                print(f"        ✗ eliminated: {ex!r}", flush=True)

    # ── 4. Summary ────────────────────────────────────────────────────────────
    not_in_registry = total - new_matched
    print("\n[3] CORPUS SCAN SUMMARY", flush=True)
    print(f"    Total distinct act names    : {total}", flush=True)
    print(f"    OLD matcher matched         : {old_matched}  ({100*old_matched/max(1,total):.2f}%)", flush=True)
    print(f"    NEW matcher matched         : {new_matched}  ({100*new_matched/max(1,total):.2f}%)", flush=True)
    print(f"    NOT_IN_REGISTRY (new)       : {not_in_registry}  ({100*not_in_registry/max(1,total):.2f}%)", flush=True)
    print(f"    False positives ELIMINATED  : {len(false_positives_eliminated)}", flush=True)

    # ── 5. Show up to 20 eliminated false positives ───────────────────────────
    print("\n[4] Sample false positives eliminated (up to 20):", flush=True)
    for act_name, old_id, label in false_positives_eliminated[:20]:
        print(f"    {act_name!r:60s}  was={old_id}  {label}", flush=True)
    if len(false_positives_eliminated) > 20:
        print(f"    … and {len(false_positives_eliminated)-20} more", flush=True)

    # ── 6. Show up to 10 valid new matches ────────────────────────────────────
    print("\n[5] Sample valid new matches:", flush=True)
    for act_name, new_id in new_true_match_examples:
        print(f"    {act_name!r:60s}  → {new_id}", flush=True)

    # ── 7. Why logs showed 0 NOT_IN_REGISTRY hits on live chat ────────────────
    print("\n[6] Why logs showed 0 NOT_IN_REGISTRY hits on live chat:", flush=True)
    print("    • annotate_provisions IS on the live-chat path:", flush=True)
    print("      pipeline.py:264-265  →  run_post_retrieval  →  annotate_provisions(filtered_corpus/db)", flush=True)
    print("    • NOT_IN_REGISTRY logs are at logger.INFO level — likely filtered", flush=True)
    print("      if backend runs with log-level WARNING (common in production).", flush=True)
    print("    • Each chat retrieves only 3-6 provisions per query, mostly from", flush=True)
    print("      the known Acts (BNS/IPC/BNSS) that ARE in the registry.", flush=True)
    print("    • With the OLD substring matcher, acts NOT in the registry were", flush=True)
    print("      FALSELY matched (e.g. 'PARTITION...' → RTI_2005 ACTIVE),", flush=True)
    print("      masking what should have been NOT_IN_REGISTRY log entries.", flush=True)

    client.close()
    print("\nDone.", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
