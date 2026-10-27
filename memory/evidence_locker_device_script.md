# Evidence Locker — on-device verification script (A1 + A2)

Status: **UNVERIFIED on a physical device** (preview/source only; no build was made).
Run on a real Android and a real iOS device after a development build.

## Setup
1. Open DHARA → Women → Evidence locker, set/enter the PIN.
2. Allow the microphone prompt.

## Step 1 — A1 audio-session (mic lease)
- Start a voice recording. While it runs, trigger any screen that speaks (TTS).
- Expect: recording keeps the mic; TTS does not kill the recording; no native
  "AudioRecorder has already been prepared" error.

## Step 2 — A2 navigation must not discard
- Start a recording, wait ~15 s, then navigate Back / to another tab.
- Expect: status shows it was stopped and saved; returning to the locker shows a
  new saved item (segments counted), and **nothing is lost**.

## Step 3 — A2 background must not discard
- Start a recording, press Home / lock the screen for ~20 s, return.
- Expect: "Recording stopped — saving your evidence." and the recording appears
  in Saved items (or in the recovery banner), never silently deleted.

## Step 4 — Incoming call during recording  ← NEW
- Start a recording. From a second phone, place a voice call to the test device.
- Let it ring ~5 s, then **answer** it, talk ~5 s, hang up, return to DHARA.
- Expect:
  a. The mic interruption stops the recorder — it does **not** crash.
  b. Audio captured before the call is saved (visible in Saved items or the
     "Interrupted recording found" banner with its segment count).
  c. The temporary file is never deleted before its encrypted copy is saved and
     read back; if saving could not finish during the call, the next launch
     recovers it automatically and shows "Recovered unfinished recording(s)".
- Repeat once with the call **declined** instead of answered.

## Step 5 — Explicit discard requires confirmation
- Start a recording, tap "Discard recording".
- Expect a confirmation dialog; tapping Cancel keeps recording, tapping
  "Discard recording" is the only path that deletes it.

## Step 6 — Next-launch recovery
- Start a recording, then force-quit the app from the app switcher.
- Relaunch → Evidence locker → expect the recovery of the leftover temp
  recording (saved item appears) and/or the interrupted-session banner.
