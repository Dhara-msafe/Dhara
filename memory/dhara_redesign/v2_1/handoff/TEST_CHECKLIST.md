# Test checklist

The full list is REGRESSION_ACCEPTANCE.csv (every functional test: NOT RUN). Run it on web and on a physical Android build before any rollout.
Also run the design checks that were not performed (see A11Y_CHECK_REPORT.md): TalkBack/VoiceOver, OS-level large text, keyboard-open forms, RTL, real translations, gradient-background contrast, real keyboard focus order.
Record existing defects separately from redesign regressions.

## Safety warning
The audited preview runs with OUTBOUND_MODE=live and OUTBOUND_PROFILE=production. On screens that are wired, a tester could open a real dialler or SMS composer to real numbers. Run emergency, SMS and call tests on a build set to the internal_qa profile, or with test contacts only. Do not use that preview for emergency testing. Nothing sends without a user tap, but do not rely on that for safety.
