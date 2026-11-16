"""
B-54 regression test — repository must not track a filename that breaks a
git clone/checkout on Windows.

Background: Windows forbids file and directory names that end in a trailing
space or a trailing period (the OS silently strips it, which makes the name
on disk never match the name git recorded, so `git clone`/`git checkout`
fails or produces a corrupted working tree for every Windows contributor).

This repo had exactly one such file: a stray, stale duplicate of
`backend/ipc_bns_mapping.json` tracked under the literal name
`backend/ ipc_bns_mapping.json.` (leading space, trailing period). It was
smaller/out of date (762 lines) versus the real, actively-imported dataset
(9,028 lines, used by build_ipc_mapping.py / server.py / corpus_db.py), and
nothing in the codebase referenced the malformed name -- it was dead weight,
so it was deleted outright rather than renamed.

This test guards against the problem recurring: any tracked path ending in
a space or a period, anywhere in the repo, fails the build.

Local-fixture only. No network, no LLM calls, no live DB writes.
"""
from __future__ import annotations

import os
import subprocess

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _git_available() -> bool:
    try:
        subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=REPO_ROOT,
            capture_output=True,
            check=True,
        )
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _git_available(), reason="not running inside a git checkout")
def test_no_tracked_path_ends_in_space_or_period():
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    tracked = result.stdout.splitlines()
    offenders = [p for p in tracked if p and (p.endswith(" ") or p.endswith("."))]
    assert offenders == [], (
        "These tracked paths end in a space or a period and will break a "
        f"clone/checkout on Windows: {offenders}"
    )


def test_malformed_ipc_bns_duplicate_is_gone():
    assert not os.path.exists(os.path.join(REPO_ROOT, "backend", " ipc_bns_mapping.json."))


def test_real_ipc_bns_mapping_file_is_untouched_and_substantial():
    real_path = os.path.join(REPO_ROOT, "backend", "ipc_bns_mapping.json")
    assert os.path.exists(real_path)
    # the real, actively-imported dataset is ~9000 lines / ~350KB; a
    # regression that accidentally deletes/truncates it instead of the
    # malformed duplicate would shrink this drastically
    assert os.path.getsize(real_path) > 200_000
