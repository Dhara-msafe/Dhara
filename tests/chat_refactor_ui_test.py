# Chat-screen refactor regression (iteration 96) — paste bodies into browser_automation, page_url=<EXPO_BACKEND_URL>/language
# Auth: reuse SEED_AUTH_JS from tests/family_journey_ui_test.py, then goto /home and tap home-type-button
# (deep-linking straight to "/" redirects to /home; use /rights -> ask-more-<id> for ?topicId).
# Flows covered (all passed):
#  - chat-screen styling, suggestion-0..3 (generic) -> tap sends question, stream + followup-chip-*
#  - "What is Article 21?" -> legal-details-toggle-<id> View/Hide -> citations-<id> (Article 21, stale warning)
#  - IPC notice: backend refuses IPC queries (no citation), so stream was route-mocked with an IPC citation
#    -> ipc-notice-<key> "renumbered or replaced under BNS 2023" (only after expanding legal details)
#  - "help me" -> sos-emergency-banner, sos-call-112/1091/100, sos-banner-dismiss
#  - guest limit (client override gk_user.is_guest + guest_question_count=5, abort /api/auth/me)
#    -> guest-limit-bar + emergency-call-shortcut, emergency-call-112/181
#  - "help me file an FIR" -> fir-intent-cta-<id> -> /fir-draft
#  - new-chat-button -> next /api/chat/stream body carries a fresh session_id (follow-ups reuse server id)
#  - /rights topic-arrest -> ask-more-arrest -> /?topicId=arrest shows TOPIC_SUGGESTIONS.arrest chips
#  - Copy: home-family-journey-card 'YOU PRESS SEND'; me-me.familyJourney no 'Preview'; fj-privacy-toggle-card ON copy
