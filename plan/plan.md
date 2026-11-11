# DHARA Advocate Consultation Notetaker — Phase 1 Plan

DHARA already serves advocates through a dedicated tab covering client intakes, legal research, and IPC-BNS cross-reference. This feature extends that tab with a structured consultation notetaking workflow: an advocate opens or creates a matter, records participant consent, captures notes or imports a transcript, reviews and corrects the transcript, generates a structured draft note with source references, approves an exact version, and exports it or converts it to local tasks.

## Who it is for

Registered DHARA advocates handling in-person or remote legal consultations who need a structured, auditable record of what was said, what was advised, and what must happen next — without fabricating facts or using unapproved AI inference.

---

## Core Features and Experience

**Matter list.** The advocate dashboard gains a "Consultation Notes" card. Tapping it opens a list of matters the advocate owns, with a creation action. A matter is a named client case that holds all consultations for that client.

**Consultation setup.** Inside a matter, the advocate creates a consultation: gives it a date and purpose, picks the input method (manual notes, transcript text import, or audio file import), and optionally notes the language. Unsupported input methods are hidden or labelled unavailable.

**Participant consent.** Before any capture begins, the screen shows a notice to all participants. The advocate records each participant's decision (given / declined / withdrawn) individually. A decline or withdrawal blocks recording and processing for that participant. The advocate's own attestation is not treated as proof of individual consent.

**Input: manual notes.** A free-text editor. The advocate types during or after the consultation. No recording, no transcription.

**Input: transcript import.** The advocate uploads a plain-text (.txt) transcript. The system stores the original unmodified. The advocate can then correct text and assign provisional speaker labels.

**Input: audio file import.** The advocate uploads a supported audio file (.mp3, .wav, .m4a). The file is validated (size, format, duration, hash), stored privately, and queued for Whisper transcription. The advocate sees truthful processing states and can cancel before transcription starts.

**Transcript review.** Both imported and transcribed transcripts are shown with the original preserved separately. The advocate edits a working copy, assigns or corrects provisional speaker labels (plain names, not inferred identities), and approves the reviewed transcript before note generation proceeds. Timestamps are shown only when the source file provides them; they are never invented.

**Structured draft note.** The system generates a draft that separates: verified client facts, client instructions, advocate advice given, open uncertainties, and proposed actions / next steps. Each extracted fact carries a reference back to the transcript passage it came from. The Legal Truth pipeline provides any statute citations; no facts are inferred beyond what the transcript contains.

**Advocate edits and approval.** The advocate edits the draft in-place. Approving captures the reviewer identity and an exact version hash. Subsequent edits create a new version; the approved version is immutable.

**Export and tasks.** An approved note can be exported as a PDF or plain text. Proposed actions can be saved as local task drafts within the app. All exports enforce matter access; no data leaves without an explicit advocate action.

---

## User Flow

```
Advocate tab (registered)
  → Consultation Notes card
      → Matter list  [empty state → create matter]
          → Matter detail  [consultation list → create consultation]
              → Consultation setup  (title, date, input method, language)
                  → Participant consent  (per-person: given / declined / withdrawn)
                      → Input screen
                          Manual notes  →  Review note draft
                          Transcript import  →  Transcript review  →  Review note draft
                          Audio import  →  Upload progress  →  Processing state  →  Transcript review  →  Review note draft
                      → Note review and editing
                          → Approve version
                              → Approved note + export / task drafts
```

Error and interruption paths surface at every step with truthful state labels (FAILED, CANCELLED, INTERRUPTED). Retry is explicit; nothing retries silently.

---

## UI/UX Feel

Screens reuse the existing DHARA advocate palette: deep navy header, gold accents, white card surfaces, 14 px body text at 1.5× line height. No new design language is introduced. The seven screens described in the UI/UX handoff map directly onto the flow above.

Consent and transcript screens are intentionally plain and legible — no animations, no progress-bar theatrics. State labels are literal (PROCESSING, TRANSCRIPT_REVIEW, APPROVED) so the advocate always knows what the system is doing and what they must do next. Touch targets follow the existing 48 dp minimum. Screens are accessible by keyboard and screen reader.

---

## Implementation Phases

### Phase 1 — MVP (built now)

- Matter data model and backend router (create, list, get — advocate-scoped).
- Consultation data model and state machine (DRAFT → CONSENT_PENDING → READY → IMPORTING → AUDIO_REVIEW → PROCESSING → TRANSCRIPT_REVIEW → NOTE_DRAFT → APPROVED, plus FAILED / CANCELLED / INTERRUPTED).
- Participant consent record per consultation.
- Manual notes input and direct draft generation.
- Text transcript import, correction, and provisional speaker labelling.
- Audio file import, Emergent Object Storage upload, Whisper STT via existing `stt_engine.py`, truthful processing states, cancellation.
- Draft note generation (facts / instructions / advice / uncertainties / actions) using the existing AI pipeline with source references to transcript passages.
- Advocate edit, versioned approval, immutable approved artefact.
- PDF/text export and local task draft creation.
- Seven frontend screens inside the advocate section, fully responsive and accessible.
- Server-enforced tenant and matter authorisation on every endpoint.
- Synthetic test data only; no production database records touched.

### Phase 2 — Live microphone capture

- In-person microphone capture on iOS and web using the existing voice platform (`voicePlatform.ts`).
- Streaming or chunked upload to Whisper with live status display.
- Audio level indicator.
- Interruption handling: app background, OS permission revoked, storage full.
- Consent withdrawal mid-recording halts capture immediately.

### Phase 3 — Engine replacement and advanced features

- Swap Whisper for the future DHARA-controlled speech engine via the replaceable STT interface built in Phase 1; no other code changes required.
- Multi-language transcript support beyond Hindi/English.
- Speaker diarisation when available from the engine.
- Direct call and WhatsApp recording (requires separate feasibility study; outside current scope).

---

## Assumptions

- **Advocate authentication**: Matters are owned by the authenticated advocate user. The existing `useAuth` token and advocate profile record are used; no new auth layer is added.
- **Matter as a new model**: Matters do not currently exist in the backend. They will be a new MongoDB collection. The existing "intake" concept is not reused — intakes are outbound client links; matters are advocate-side case records.
- **Backend router placement**: A new `advocate_notetaker_router.py` is added alongside existing routers and registered in `server.py`. No existing router is modified.
- **STT provider**: OpenAI Whisper via the existing `engine/stt_engine.py` and Emergent LLM key. No new API key or billing activation required.
- **Storage**: Emergent Object Storage via the existing `services/object_storage.py`. Audio files are stored privately, scoped by matter ID. No new storage account required.
- **Draft note generation**: The existing `engine/pipeline.py` and `engine/answer_generator.py` are called with a structured prompt derived from the reviewed transcript. Legal Truth (`legal.py`) provides statute citations only when explicitly requested. No new LLM provider is introduced.
- **Audio constraints**: Files up to 25 MB, formats mp3/wav/m4a, duration up to 90 minutes, matching Whisper limits. Files outside these limits are rejected before upload begins.
- **Missing documents**: The Technical Blueprint and Speech Engine Strategy documents were not found in the codebase and were not uploaded. This plan is based on the Implementation Brief and UI/UX Handoff alone. If the Blueprint contains conflicting architecture decisions they should be raised before build starts.
- **No production impact**: All new collections, routes, and screens are isolated behind a `FEATURE_ADVOCATE_NOTETAKER` flag that is off in production. Existing Legal Truth, safety, voice, and guardian features are not modified.
- **Export format**: PDF export uses the device share sheet on native and the browser print dialog on web. No external PDF service required.
- **Consent is advocate-managed**: The system records what the advocate attests each participant said. It cannot independently verify participant identity or consent. This limitation is disclosed on the consent screen.
- **Speaker labels**: Plain free-text strings entered by the advocate (e.g., "Client", "Advocate", "Witness 1"). No automatic speaker identification is performed.
