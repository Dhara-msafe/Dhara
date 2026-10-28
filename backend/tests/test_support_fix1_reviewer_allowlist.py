"""Emergent support fix 1: approvals additionally require an allowlisted,
active, unrevoked reviewer. All registries/allowlists here are in-memory
(or tmp files); the real on-disk registry is never written."""
import json
import os
import sys

import pytest

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BACKEND_DIR)

import engine.approval_evidence as ae  # noqa: E402
from engine.approval_evidence import check_approval, compute_content_hash  # noqa: E402

TEXT = "the exact approved text"


def _approval(reviewer_id="adv.legal.lead"):
    return [{
        "approval_id": "A-100", "record_type": "correspondence", "subject_key": "IPC:302->BNS:103",
        "content_hash": compute_content_hash(TEXT), "reviewer_id": reviewer_id, "status": "active",
    }]


def _reviewer(reviewer_id="adv.legal.lead", **kw):
    r = {"reviewer_id": reviewer_id, "name": "Synthetic Lead", "status": "active",
         "revoked_at": None, "added_at": "2026-10-28T00:00:00Z"}
    r.update(kw)
    return r


def _check(reg, allow):
    return check_approval("correspondence", "IPC:302->BNS:103", compute_content_hash(TEXT),
                          registry=reg, authorized_reviewers=allow)


def test_unauthorized_reviewer_rejected():
    r = _check(_approval("someone.else"), [_reviewer()])
    assert r.approved is False and r.reason == "unauthorized_reviewer"


def test_revoked_reviewer_rejected():
    r = _check(_approval(), [_reviewer(status="revoked", revoked_at="2026-10-28T01:00:00Z")])
    assert r.approved is False and r.reason == "unauthorized_reviewer"
    r2 = _check(_approval(), [_reviewer(revoked_at="2026-10-28T01:00:00Z")])  # status still active
    assert r2.approved is False and r2.reason == "unauthorized_reviewer"


def test_empty_allowlist_rejected():
    r = _check(_approval(), [])
    assert r.approved is False and r.reason == "unauthorized_reviewer"


def test_default_allowlist_on_disk_is_empty_so_nothing_approved():
    # A fully valid synthetic approval still fails against the real (empty) allowlist.
    r = _check(_approval(), None)
    assert r.approved is False and r.reason == "unauthorized_reviewer"


@pytest.mark.parametrize("content", ["{not json", json.dumps({"approvals": [], "authorized_reviewers": "adv.legal.lead"})])
def test_malformed_allowlist_file_fails_closed(tmp_path, monkeypatch, content):
    bad = tmp_path / "registry.json"
    bad.write_text(content)
    monkeypatch.setattr(ae, "_REGISTRY_PATH", bad)
    ae._load_authorized_reviewers.cache_clear()
    try:
        assert ae._load_authorized_reviewers() == []
        r = _check(_approval(), None)
        assert r.approved is False
    finally:
        monkeypatch.undo()
        ae._load_authorized_reviewers.cache_clear()


def test_allowlisted_active_matching_hash_is_approved():
    r = _check(_approval(), [_reviewer()])
    assert r.approved is True and r.reason == "approved" and r.reviewer_id == "adv.legal.lead"


def test_real_on_disk_registry_yields_not_approved_for_arbitrary_subject():
    ae._load_registry.cache_clear()
    ae._load_authorized_reviewers.cache_clear()
    r = check_approval("correspondence", "IPC:420->BNS:318", compute_content_hash("anything"))
    assert r.approved is False
    raw = json.loads(ae._REGISTRY_PATH.read_text())
    assert raw["approvals"] == [] and raw["authorized_reviewers"] == []
