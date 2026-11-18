#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: "DHARA v2.2 redesign continuation: Fix consent management UI (ID-47 consent toggles missing from JSX, add consent record screen-54, consent history ledger screen-55). Verify EL-055 (feature flag block) and EL-054 (orphaned temp file cleanup). Check external privacy policy URL. Update regression CSV and produce final 57-screen reconciliation report."

backend:
  - task: "GET /api/user/consent-history endpoint (Screen 55)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Added GET /api/user/consent-history?limit=10 before SPA catch-all (around line 2211). Returns entries+total. Confirmed working via curl: returns 10 of 53 entries for voicetest2026@example.com. Auth: Bearer token from POST /api/auth/login (field 'token' not 'access_token')."

  - task: "PATCH /api/user/privacy-choices (consent toggle persistence)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Existing endpoint. Saves consent_purposes to users collection AND inserts audit entry into consent_log. event='privacy_choices_update'. Body: {analytics: bool, updates: bool}."

  - task: "EL-055: Evidence locker blocked when flag disabled"
    implemented: true
    working: "NA"
    file: "backend/api/evidence_vault_router.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Implemented in previous session. Backend guard returns 403 when evidence_locker_enabled=False. Test by setting flag false in env, calling /api/evidence/vault, expecting 403."

  - task: "EL-054: Orphaned temp file cleanup"
    implemented: true
    working: "NA"
    file: "frontend/src/women/evidenceStore.ts"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "sweepOrphanedEvidenceTempFiles() implemented in evidenceStore.ts. Called on evidence-locker.tsx mount. Test: verify function exists and is called on mount."

frontend:
  - task: "Consent preferences toggles (ID-47 / analytics + updates) in data-privacy.tsx"
    implemented: true
    working: "NA"
    file: "frontend/app/settings/data-privacy.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: false
          agent: "main"
          comment: "Previous session added state/handlers but forgot to render JSX."
        - working: false
          agent: "testing"
          comment: "CRITICAL: fetched /api/user/me (404). Toggles always OFF, record card showed dashes."
        - working: "NA"
          agent: "main"
          comment: "Fixed: changed /api/user/me to /api/auth/me. /api/auth/me confirmed returns terms_version, consent_purposes, terms_accepted_at correctly for voicetest2026@example.com."

  - task: "Consent record card (Screen 54) in data-privacy.tsx"
    implemented: true
    working: "NA"
    file: "frontend/app/settings/data-privacy.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: false
          agent: "testing"
          comment: "CRITICAL: fetched /api/user/me (404). Record card showed dashes."
        - working: "NA"
          agent: "main"
          comment: "Fixed: same root cause as toggles. /api/auth/me now used."

  - task: "Consent history ledger (Screen 55) in data-privacy.tsx"
    implemented: true
    working: "NA"
    file: "frontend/app/settings/data-privacy.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Added collapsible 'Consent history' accordion (testID='consent-history-accordion'). Auto-loads last 10 entries from /api/user/consent-history when expanded. 'View all N entries' button (testID='consent-history-view-all') loads all with limit=0. Each entry: event label, formatted timestamp, purpose chips, notice version. Timeline with dot+line visual."

metadata:
  created_by: "main_agent"
  version: "2.0"
  test_sequence: 1
  run_ui: true

test_plan:
  current_focus:
    - "GET /api/user/consent-history returns entries for authenticated user (backend)"
    - "PATCH /api/user/privacy-choices saves and audit-logs consent change (backend)"
    - "Consent preferences toggles render, load, and persist (frontend)"
    - "Consent record card shows version + timestamp + purposes (frontend)"
    - "Consent history accordion loads 10 entries, View all expands to full log (frontend)"
    - "EL-055 backend guard returns 403 when evidence_locker_enabled=False (backend)"
    - "EL-054 sweepOrphanedEvidenceTempFiles exists in evidenceStore.ts (code review)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: "PRIVACY URL FIX: Changed privacy policy URL from dhara.msafesolutions.com/privacy.html to askdhara.in/privacy.html. Changes: (1) src/operatorIdentity.ts — added exported constant privacyPolicyUrl = 'https://askdhara.in/privacy.html' as single source of truth. (2) app/consent.tsx — imported privacyPolicyUrl from operatorIdentity.ts and replaced the hardcoded old URL on the 'Read full privacy policy' link (testID='consent-read-full-privacy'). All other contacts already correct (callistus@askdhara.in, Varuna Moses, varuna@calviltech.com) in operatorIdentity.ts. Verify: tap 'Read full privacy policy' on consent screen → should open askdhara.in/privacy.html. Credentials: voicetest2026@example.com / TestPass123!"
