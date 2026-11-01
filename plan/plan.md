# DHARA Greeting & Suggested-Question Fix

DHARA currently sends every message — including greetings and its own suggested follow-up questions — through the legal-corpus search. This returns a "cannot confirm from official text" refusal for any message that has no corpus match, making the app feel broken from the very first interaction.

The fix adds a lightweight intent layer that catches greetings and capability questions before they reach the corpus, returns a friendly built-in reply, and replaces the existing suggested questions with ones DHARA can actually answer.

---

## Who it's for

Existing DHARA users on Android and web who see the broken first-message flow described above.

---

## Core features and experience

**Greeting / capability intent detection**
A small set of patterns (hi, hello, namaste, good morning/evening, what can you do, how do you help, what issues, what topics, etc.) is checked at the start of every send. If the message matches, DHARA skips the corpus search entirely and returns a single pre-written reply.

**Capability reply content**
The reply briefly introduces DHARA and lists the areas it covers: FIR filing & police complaints, domestic violence protection, property & inheritance rights, maintenance & matrimonial issues, workplace harassment (POSH), consumer rights, criminal procedure (BNS / IPC), and rights cards for common situations. It ends with an invitation to ask a specific question.

**Corrected suggested questions**
The follow-up question chips shown after any DHARA response are replaced with questions the corpus can actually answer — for example "What happens if police refuse my FIR?" or "What are my rights under the Protection of Women from Domestic Violence Act?" — rather than meta-questions about DHARA's own scope. The initial greeting screen's chips are also updated to match.

**No change to legal answers**
Any message that does not match the greeting/capability patterns continues through the existing corpus search path unchanged. No existing legal-answer behaviour is altered.

---

## User flow

1. User opens a new chat. DHARA displays its existing greeting message.
2. Suggested chips below it are legal questions DHARA can answer (updated).
3. User taps a chip or types "hi". DHARA returns the friendly capability reply immediately, without a spinner or corpus lookup.
4. New follow-up chips below that reply are also legal questions DHARA can answer.
5. User taps one. DHARA answers from its corpus as normal.

---

## UI/UX feel

No visual changes. The capability reply uses the same Dhara message bubble. The chip style is unchanged; only the text of the chips is updated.

---

## Implementation phases

**Phase 1 — MVP (built now)**
- Add greeting/capability intent check to the backend send handler (runs before corpus search).
- Write the capability reply string (English; same i18n pipeline as other responses for other languages).
- Replace the initial suggested-question chips with three to four questions answerable from the corpus.
- Replace the follow-up chips after the capability reply with similar answerable questions.

**Phase 2 — Multilingual capability reply**
Translate the capability reply into the other supported languages (Hindi, Bengali, Tamil, etc.) using the same translation mechanism used elsewhere in the app.

**Phase 3 — Adaptive suggestions**
Generate follow-up chip suggestions dynamically based on the topic of the previous answer (e.g. a DV answer suggests chips about protection orders, maintenance, and evidence), so suggestions always stay relevant to the conversation.

---

## Assumptions

- The intent check is a simple keyword / short-phrase match on the backend, not an LLM classifier, to keep latency at zero and cost at zero.
- "Capability question" covers: what can you do, what issues, what topics, how can you help, what kind of questions, tell me about yourself, and close variants — decided without asking.
- The capability reply lists eight topic areas listed above; the exact wording is decided during implementation.
- The initial greeting message text itself is not changed; only the suggested chips below it are updated.
- The fix is in English first; other languages follow in Phase 2.
- Existing corpus-search refusal messages ("I cannot confirm from the official text") are not changed for genuinely unanswerable legal questions — only greeting/capability inputs are rerouted.
