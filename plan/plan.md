# DHARA Family Journey — Student-Controlled Trip Sharing (Phase 1: Preview)

A way for an adult user — including a student living away from home — to plan a journey, decide who could be told about it and exactly what they'd see, and preview that sharing on their own phone before any of it is real. Nothing is sent to anyone in this phase; it proves the idea and the consent flow safely before any real sharing exists.

## Who it's for

Adult DHARA users who want to plan a trip and think through sharing it with a trusted contact — most often a parent, but the feature is not limited to any one relationship or gender — before turning real sharing on in a later release.

## Core features and experience

- **Create a journey**: a destination label, expected departure/arrival/return windows, and an optional check-in reminder interval.
- **Pick contacts**: choose from the student's existing Trusted Circle for this journey. This only reads the existing contact list to populate a picker — no invitation or message is sent to anyone.
- **Four separate sharing permissions, not stacked levels** — each one requires its own explicit confirmation and can be turned on or off independently:
  - *Local-only* — nothing leaves the phone (the default).
  - *Arrival notification* — a contact would be told when the student confirms arrival.
  - *Late / missed check-in notification* — confirmed separately from arrival; uses fixed, neutral wording only ("Check-in not received") and never implies the student is safe or in danger.
  - *Student-initiated help request* — a deliberate action the student takes themselves; never automatic.
  - *(Temporary location sharing is a distinct, later-phase permission — not part of this phase at all.)*
- **Live preview**: for every contact and every mode chosen, the student sees — on their own device only — exactly what that contact would receive, worded exactly as it would be worded for real, clearly labelled **"Preview — nothing has been sent."**
- **Journey controls**: manual check-in, "I've arrived," change the plan, or stop — all instant, local, and available with one tap and no reason required.
- **Help stays reachable**: SOS, calling for help, and DHARA's existing legal-help tools remain visible and usable from every Family Journey screen, with no subscription or payment requirement.
- **No institution** (school, employer, hostel, etc.) ever receives any journey information in this phase.
- **No location data of any kind** — not even a last-known point — is collected, stored, or shown in this phase.

## User flow

1. The student opens Family Journey from its own section and creates a journey: destination label, timing, optional check-in interval.
2. The student picks one or more Trusted Circle contacts and a sharing mode for each, or leaves everything local-only.
3. Before finishing, the student sees a preview screen per contact and per mode — exactly what that contact would see, clearly marked as a preview.
4. The student starts the journey; reminders appear only as local notifications on their own phone.
5. The student checks in, marks arrival, changes the plan, or stops at any time, with one tap and no explanation required.
6. If a check-in is missed, the student's own preview reflects "check-in not received" — nothing leaves the phone, and nothing is shown as a finding of safety or danger.
7. A visible path to SOS, emergency calling, or legal help stays one tap away throughout.

## UI/UX feel

Calm and plain, consistent with the rest of DHARA — no urgency styling, no red "danger" badges triggered by a missed check-in, no countdown that feels punitive. Wherever a contact-facing screen is being previewed, the **"Preview — nothing has been sent"** label is visually distinct and unmissable, so the student is never confused about what is and isn't real yet.

## Implementation phases

**Phase 1 (MVP — built now)**
Everything described above. Entirely on the student's device: no server-side timers, no notification queue, no real notifications, no real location, no screen a contact can actually open, and no payment. Open to every user by default, with a quick app-wide switch to turn the whole feature off if needed. Built as its own, separate piece of the app so it cannot change how Women's Shield, Guardian Journey, SOS, or Trusted Circle behave today.

**Phase 2**
Real delivery: arrival and missed-check-in notices actually reach the chosen contact. Requires a backend scheduling and delivery system built and reviewed on its own terms — offline phones, clock and time-zone changes, retries, and duplicate sends all need to be handled correctly before this phase ships. Still no location sharing.

**Phase 3**
Temporary location sharing, plus a secure, time-limited way for a contact (such as a parent) to view a journey's status — using something that expires and re-checks permission every time it's opened, not a link that keeps working forever. Any payment or subscription question only becomes relevant from this phase onward, once there is a real feature behind it.

## Assumptions

- Phase 1 only reads the existing Trusted Circle list to populate the contact picker; it does not reuse or modify any existing safety-session, SOS, or Guardian Journey logic, so none of today's behavior there can be affected.
- There is nothing for a parent or any other contact to install, log into, or view in Phase 1 — that is entirely Phase 3 scope.
- No payment or subscription is attached to Phase 1, since nothing real is being shared yet.
- The wording "Check-in not received" is used exactly as written, and is never paired with language suggesting the student is safe or in danger.
- An app-wide switch to disable Family Journey entirely is built in from the start as a safety net, even though the feature ships visible to all users rather than a limited group.
- All consent and mode choices made in Phase 1 are stored only on the student's own device; nothing is synced to any contact or institution.
