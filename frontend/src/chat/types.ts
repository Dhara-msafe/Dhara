/** Chat message + citation shapes shared by the chat screen and its helpers. */

export type Citation = {
  key: string;
  citation: string;
  short_label: string;
  act: string;
  official_text: string;
  source_url: string;
  verified_at: string;
  /** Populated when the act is not yet in the verified law registry.
   *  Displayed as an info note — does not imply approval or verification. */
  registry_gap_note?: string;
};

export type Msg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode?: 'basic' | 'pro';
  citations?: Citation[];
  /** Server told us this topic is decided by state law and no state is set yet */
  statePrompt?: string;
  /** State is set but Dhara has no verified local rule for it yet */
  stateNote?: string;
  /** Set once the user has bookmarked this answer for offline use */
  saved?: boolean;
  /** The user's own message text matched FIR/police-complaint drafting intent */
  firIntent?: boolean;
  /** 2-3 contextual follow-up questions generated after the answer */
  followUpQuestions?: string[];
};
