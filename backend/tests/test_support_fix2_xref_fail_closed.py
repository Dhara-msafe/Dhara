"""Emergent support fix 2: GET /api/advocate/cross-reference fails closed.

Calls the real route handler (server.cross_reference) directly, no live
server or DB. Approvals are injected in memory by monkeypatching the
approval-evidence loaders; the real registry file is never written.
"""
import asyncio
import json
import os
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")

import server  # noqa: E402
import engine.approval_evidence as ae  # noqa: E402
from engine.approval_evidence import compute_content_hash  # noqa: E402
from engine.correspondence_gate import entry_content_hash, entry_subject_key  # noqa: E402

TOP_LEVEL_KEYS = {"results", "total", "citation_guard", "which_code_applies", "effective_date", "disclaimer"}
REVIEWER = {"reviewer_id": "adv.synthetic.lead", "name": "Synthetic", "status": "active",
            "revoked_at": None, "added_at": "2026-10-28T00:00:00Z"}


def _entry_302():
    return next(e for e in server._load_xref()["ipc_complete_mapping"] if str(e.get("ipc_section")) == "302")


def _approval(entry, **over):
    rec = {"approval_id": "T-302", "record_type": "correspondence", "subject_key": entry_subject_key(entry),
           "content_hash": entry_content_hash(entry), "reviewer_id": REVIEWER["reviewer_id"], "status": "active"}
    rec.update(over)
    return rec


@pytest.fixture
def inject(monkeypatch):
    def _set(approvals, reviewers=(REVIEWER,)):
        monkeypatch.setattr(ae, "_load_registry", lambda: list(approvals))
        monkeypatch.setattr(ae, "_load_authorized_reviewers", lambda: list(reviewers))
    return _set


def _call(**kw):
    params = {"q": "", "ipc": "", "bns": ""}
    params.update(kw)
    return asyncio.run(server.cross_reference(**params))


def test_canonical_hash_is_sorted_key_json_of_substantive_fields():
    e = _entry_302()
    canonical = json.dumps({"source_section": "302", "target_section": "103(1)", "provision_text": e["offence"],
                            "punishment_note": "", "what_changed": e["what_changed"]},
                           sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    assert entry_content_hash(e) == compute_content_hash(canonical)
    assert entry_subject_key(e) == "IPC:302->BNS:103(1)"


def test_default_empty_registry_withholds_everything():
    resp = _call(ipc="302")
    assert set(resp) == TOP_LEVEL_KEYS
    cg = resp["citation_guard"]
    assert cg["approval_gate"] == "fail_closed"
    assert resp["total"] > 0 and cg["withheld_count"] == resp["total"]
    body = json.dumps(resp["results"], ensure_ascii=False)
    assert "103(1)" not in body
    for r in resp["results"]:
        assert r["correspondence_withheld"] is True and r["withheld_reason"]
        assert r["new_section"] == "" and r["what_changed"] == "" and r["offence"] == ""
        assert "_raw_entry" not in r
    assert any(r["old_section"] == "302" for r in resp["results"])


def test_bns_direction_query_withholds_the_old_code_side():
    resp = _call(bns="103")
    assert resp["results"]
    for r in resp["results"]:
        assert r["correspondence_withheld"] is True
        assert r["old_section"] == ""


def test_injected_approved_relationship_is_released(inject):
    inject([_approval(_entry_302())])
    resp = _call(ipc="302")
    hit = next(r for r in resp["results"] if r["old_section"] == "302")
    assert hit["correspondence_withheld"] is False
    assert hit["new_section"] == "103(1)"
    assert hit["what_changed"]


def test_approved_relationship_with_unlisted_reviewer_is_withheld(inject):
    inject([_approval(_entry_302())], reviewers=())
    hit = next(r for r in _call(ipc="302")["results"] if r["old_section"] == "302")
    assert hit["correspondence_withheld"] is True and hit["withheld_reason"] == "unauthorized_reviewer"


def test_hash_mismatch_is_withheld(inject):
    inject([_approval(_entry_302(), content_hash="0" * 64)])
    hit = next(r for r in _call(ipc="302")["results"] if r["old_section"] == "302")
    assert hit["correspondence_withheld"] is True and hit["withheld_reason"] == "hash_mismatch"
    assert hit["new_section"] == ""


def test_one_side_only_approval_is_withheld(inject):
    # Correct hash and source, but the subject_key names a different target.
    inject([_approval(_entry_302(), subject_key="IPC:302->BNS:999")])
    hit = next(r for r in _call(ipc="302")["results"] if r["old_section"] == "302")
    assert hit["correspondence_withheld"] is True
    assert "103(1)" not in json.dumps(hit)


def test_registry_load_failure_withholds_everything(tmp_path, monkeypatch):
    bad = tmp_path / "registry.json"
    bad.write_text("{this is not json")
    monkeypatch.setattr(ae, "_REGISTRY_PATH", bad)
    ae._load_registry.cache_clear()
    ae._load_authorized_reviewers.cache_clear()
    try:
        resp = _call(ipc="302")
        assert resp["citation_guard"]["withheld_count"] == resp["total"] > 0
        assert "103(1)" not in json.dumps(resp["results"], ensure_ascii=False)
    finally:
        monkeypatch.undo()
        ae._load_registry.cache_clear()
        ae._load_authorized_reviewers.cache_clear()
