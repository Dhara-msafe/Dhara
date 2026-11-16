"""B-28 — sign-up must not reveal whether an email is already registered.

Background: before this fix, POST /api/auth/register returned the literal
message "Email already registered" (HTTP 400) whenever the submitted email
already had an account. That let anyone probe, from the sign-up form alone,
whether a specific person's email is registered with the app at all --
without ever needing a password. /api/auth/login already avoids this (its
401 for a wrong password and for an unknown email is the exact same
INVALID_LOGIN_MSG string, specifically so failed-login responses can't be
used to enumerate accounts either -- see the comment above that constant
and the login() handler itself).

Fix: both places register() can discover the email is taken (the upfront
`find_one` check, and the `DuplicateKeyError` race-condition path for two
concurrent sign-ups) now raise the SAME INVALID_LOGIN_MSG text login
already uses, instead of a distinguishing "Email already registered"
message. The frontend sign-up screen (frontend/app/signup.tsx) does no
special-casing of this text either -- it just surfaces whatever message
the backend sends -- so fixing the backend message is the whole fix.

This is a source-level check (no live Mongo/HTTP server available in this
sandbox -- the project's own test suite requires DB_NAME=dhara_qa_<name>
against a running MongoDB, which isn't present here). It statically
verifies the source rather than exercising the live endpoint. Same
convention as the frontend's adminUpiReviewGate.test.mjs / adminIssuesGate
source-wiring tests used elsewhere in this release for the same reason.

Local-fixture only. No network, no LLM calls, no live DB writes.
"""
from __future__ import annotations

import os
import re

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH_ROUTER_PATH = os.path.join(BACKEND_DIR, "api", "auth_router.py")
SIGNUP_TSX_PATH = os.path.join(
    os.path.dirname(BACKEND_DIR), "frontend", "app", "signup.tsx"
)

with open(AUTH_ROUTER_PATH, "r", encoding="utf-8") as f:
    AUTH_SRC = f.read()


def test_the_revealing_message_is_gone():
    assert "Email already registered" not in AUTH_SRC, (
        "the account-revealing 'Email already registered' string must not "
        "appear anywhere in auth_router.py"
    )


def test_register_has_exactly_two_duplicate_email_guards_and_both_use_the_neutral_message():
    # the upfront existence check, and the DuplicateKeyError race path
    raise_sites = list(
        re.finditer(r'raise HTTPException\(400, INVALID_LOGIN_MSG\)', AUTH_SRC)
    )
    assert len(raise_sites) == 2, (
        "expected exactly 2 call sites reusing INVALID_LOGIN_MSG for the "
        f"duplicate-email case in register(), found {len(raise_sites)}"
    )


def test_login_and_register_share_the_literal_same_constant_not_a_lookalike_copy():
    # guards against someone "fixing" this by introducing a second,
    # differently-worded constant instead of reusing the real one
    assert AUTH_SRC.count("INVALID_LOGIN_MSG = (") == 1, (
        "there must be exactly one INVALID_LOGIN_MSG definition, reused by "
        "both login() and register()"
    )


def test_duplicate_key_error_path_is_also_fixed_not_just_the_upfront_check():
    # isolate the DuplicateKeyError except-block specifically, so a fix that
    # only patched the upfront find_one() check (and left the race-condition
    # path revealing) would fail this test
    except_block_match = re.search(
        r"except DuplicateKeyError:\n(?:\s*#.*\n)*\s*raise HTTPException\((\d+), (.+)\)",
        AUTH_SRC,
    )
    assert except_block_match, "could not find the DuplicateKeyError except block"
    assert except_block_match.group(2).strip() == "INVALID_LOGIN_MSG", (
        "the DuplicateKeyError race-condition path must raise the same "
        f"neutral INVALID_LOGIN_MSG, found: {except_block_match.group(2)!r}"
    )


def test_frontend_signup_screen_does_no_special_casing_of_the_backend_message():
    # confirms the whole fix really is backend-only: the frontend's error
    # handler must just display whatever message the backend sends, with no
    # conditional branching on its content (e.g. detecting a duplicate-email
    # failure and swapping in an "already have an account?" prompt), which
    # would reintroduce the leak at the UI layer even after the backend
    # message itself is neutral. (The static "Already registered? Log in"
    # link elsewhere on the page is shown to every visitor regardless of any
    # form submission or its outcome, so it reveals nothing and is fine.)
    if not os.path.exists(SIGNUP_TSX_PATH):
        return  # frontend tree not present in this checkout; nothing to check
    with open(SIGNUP_TSX_PATH, "r", encoding="utf-8") as f:
        signup_src = f.read()
    catch_match = re.search(r"catch \(e: any\) \{([\s\S]*?)\}", signup_src)
    assert catch_match, "could not find the register() catch block"
    catch_block = catch_match.group(1)
    assert "e?.message" in catch_block or "e.message" in catch_block
    assert "includes(" not in catch_block
    assert "already" not in catch_block.lower()
