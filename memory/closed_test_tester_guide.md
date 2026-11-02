# DHARA — Closed Test Guide (Candidate 1)

Thank you for testing DHARA. This is a pre-release build for a small, invited group.

## Before you start
- Use a test account, or your own account if you're comfortable doing so. Do not enter real case details about other people.
- **Never call 112 or send a real alert as a test** unless the test lead has asked you to and the person receiving it knows it's a test.
- Save your trusted contacts as people who have agreed to receive test messages (for example, the test lead).

## Known limitations in this build
1. **Head Out alerts** — when a check-in is missed, this build may show *"Simulated — nothing sent"*. That is expected. The test lead will tell you whether your build is simulated.
2. **Some legal answers and rights cards are withheld** until an advocate has finished reviewing them. You may see *"I don't have a verified record…"* for IPC §166A / BNS §199 questions. That is expected, not a bug.
3. **Unplugging headphones does not pause DHARA's voice.** Tap Stop instead.
4. **Translations** of rights cards in languages other than English have not yet been reviewed by a professional. Report any wording that looks wrong.
5. **Silent Alert** opens your SMS app with the message ready to send. You still need to press Send yourself. Nothing is sent automatically.

## What we most want you to test
| # | Area | What to try |
|---|---|---|
| 1 | Code phrase | Women's Shield → Code phrase: save a phrase, then type it in Ask DHARA. Silent Alert should open once, and DHARA should not reply as if it were a chat message. Close and reopen the app, then try again. |
| 2 | Microphone | Ask DHARA by voice. Allow the mic, then deny it once and check the app explains why it needs it. |
| 3 | Evidence Locker | Record 20–30 s, play it back, delete it. Start a recording and switch away from the app, then check what was saved. |
| 4 | Phone call | While DHARA is speaking, receive a call. The voice should stop and stay stopped after the call. |
| 5 | Head Out | Pick a destination on the map, start a 30 min session, end it with "I'm home safely". |
| 6 | Scan a notice | Photograph a letter or notice and check the extracted text and explanation. |
| 7 | Languages | Switch the language to Hindi, Marathi or Tamil and ask a question by voice. |
| 8 | Help | Open the Help screen and check each tile responds. Do NOT complete a 112 call. |

## How to report a problem
Send to the test lead:
- what you did (steps), what you expected, and what happened
- a screenshot or screen recording
- phone model, Android version and app version (Me → Settings)
- the time it happened (so we can find it in the logs)

Mark it **URGENT** if it involves a safety feature (code phrase, Silent Alert, Evidence Locker, Help, 112).
