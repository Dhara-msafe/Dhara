// N-12 / B-50 — 9 of the voice/mic-arbiter tests assume
// EXPO_PUBLIC_AUDIO_ARBITER_ENABLED is already "true" in the environment.
// micArbiterGuard.test.ts's own header comment says so explicitly: "Requires
// EXPO_PUBLIC_AUDIO_ARBITER_ENABLED=true in the environment (the repo's .env
// already sets this)". But frontend/.env is, correctly, gitignored and never
// committed (see .gitignore / .env.example) — so a fresh clone, CI run, or
// this sandbox has no such .env, the flag is unset, MIC_ARBITER_ENABLED
// resolves to its default (false), and every test that exercises the "real"
// arbiter path (withMicLease, isMicHeldByEvidenceLocker, the H1 arbiter/
// speech suite) fails — not because the code is wrong, but because nothing
// in the repo actually sets the flag these tests need.
//
// This file is the repo-committed substitute: loaded via `--import` by the
// test:voice script (see package.json), before any test file's imports run,
// it sets only the one flag these tests depend on — and only when a real
// .env hasn't already set it, so a developer's own local .env still wins.
if (process.env.EXPO_PUBLIC_AUDIO_ARBITER_ENABLED === undefined) {
  process.env.EXPO_PUBLIC_AUDIO_ARBITER_ENABLED = 'true';
}
