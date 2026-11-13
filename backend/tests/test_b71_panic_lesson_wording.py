"""B-71: panic-trigger lesson wording check.

Tracker description: "Press it quickly 3 times - on most Android phones
this silently calls 112." Confirm correct wording for this brand (comes
from a backend setting, can be changed without a new APK build).

This is a Check item, not a reported bug with a known-wrong behavior, so
this is a research + sourced-correction pass (same honesty convention as
B-06's recheck): verify the claim against real device behavior, fix what
is demonstrably wrong, and say plainly what still needs a human decision.

Findings (checked against Google's own Pixel/stock-Android support docs
and Samsung One UI guidance via web search):

1. "Press it quickly 3 times" as a claim about "most Android phones" is
   wrong for Pixel/stock Android, which needs 5 rapid presses (the exact
   number this same file already uses, correctly, for iOS). Samsung One
   UI -- the dominant Android brand in India -- does use 3-4 presses, so
   the number itself isn't invented, but asserting it as "most Android
   phones" overgeneralizes one brand's behavior to the whole platform.

2. "silently calls 112" overclaims safety. Android's Emergency SOS plays
   a loud countdown alarm by default on many devices unless the user has
   turned that off. Telling someone in an unsafe situation that the
   trigger is silent, when it may not be, could put them at more risk if
   they rely on that claim.

Fix applied: hedged both claims in _PANIC_LESSON_DEFAULT["android"]
instead of asserting one brand's behavior as universal, and pointed users
to their own phone's Emergency SOS settings screen (which shows the exact
press count for that specific device) rather than a single hard-coded
number.

What this does NOT resolve: this wording is served from a backend
settings document (_id: panic_lesson_config) that an admin can override
in the live database -- this fix only corrects the Python fallback
default. If production already has an admin-set override with the old
wording, that override still needs updating directly in the settings
collection; a live check of GET /api/women/panic-lesson against the
actual deployed database is recommended (this sandbox has no reachable
backend server to query that collection).
"""
import inspect
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017/test")
os.environ.setdefault("EMERGENT_LLM_KEY", "test-key")
os.environ.setdefault("JWT_SECRET", "test-secret-12345")
os.environ.setdefault("DB_NAME", "dhara_qa_saishrin")
os.environ.setdefault("OUTBOUND_MODE", "simulate")
os.environ.setdefault("OUTBOUND_PROFILE", "internal_qa")
os.environ.setdefault("ADMIN_KEY", "test-admin-key-not-a-placeholder")

import api.women_router as women_router  # noqa: E402

ANDROID = women_router._PANIC_LESSON_DEFAULT["android"]
IOS = women_router._PANIC_LESSON_DEFAULT["ios"]


def _step_bodies(platform_cfg):
    return " ".join(s["body"] for s in platform_cfg["steps"]) + " " + platform_cfg.get("note", "")


def test_android_no_longer_overclaims_the_trigger_is_silent():
    text = _step_bodies(ANDROID).lower()
    assert "silently" not in text, (
        "Android's Emergency SOS sounds a loud alarm by default on many "
        "devices -- claiming it's silent could endanger someone who relies on that"
    )


def test_android_press_count_is_hedged_not_asserted_as_universal():
    press_step = ANDROID["steps"][1]
    # Must not flatly assert one number for "most Android phones" --
    # Pixel/stock Android needs 5, Samsung needs 3-4.
    assert "most android phones" not in press_step["body"].lower()
    assert "3" in press_step["title"] and "5" in press_step["title"]
    assert "samsung" in press_step["body"].lower()
    assert "pixel" in press_step["body"].lower() or "other android" in press_step["body"].lower()


def test_android_points_users_to_their_own_device_settings_for_the_exact_count():
    settings_step = ANDROID["steps"][-1]
    assert "exact press count" in settings_step["body"].lower() or "your phone" in settings_step["body"].lower()


def test_android_note_flags_brand_variance_explicitly():
    assert "brand" in ANDROID["note"].lower()


def test_ios_wording_unchanged_and_was_already_accurate():
    # iOS already correctly said 5 presses and never claimed silence --
    # confirm this pass didn't touch it.
    press_step = IOS["steps"][1]
    assert press_step["title"] == "Press it quickly 5 times"
    assert "silently" not in press_step["body"].lower()


def test_endpoint_falls_back_to_the_corrected_default_and_can_be_overridden_centrally():
    src = inspect.getsource(women_router.panic_lesson)
    assert "db.settings.find_one" in src
    assert "_PANIC_LESSON_DEFAULT" in src
    # Confirms the documented design this Check item's notes describe:
    # wording is centrally correctable without an app release.


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
