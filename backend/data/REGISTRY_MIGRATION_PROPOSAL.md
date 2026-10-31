# Registry Migration Proposal — String Subject Key → Canonical JSON Hash

**Status:** PROPOSAL ONLY — for review and a future GO command.
**Do NOT implement** this proposal without an explicit GO instruction and a
designated authorized reviewer sign-off on each migrated record.
**REGISTRY-001 and the live `approval_evidence_registry.json` are NOT modified
by this document.**

---

## 1. Current Schema

Each approval record in `approval_evidence_registry.json` currently uses a
plain string as the canonical identity for the approved claim:

```json
{
  "approval_id":   "REGISTRY-001-IPC166A-BNS199",
  "record_type":   "correspondence",
  "subject_key":   "IPC:166A->BNS:199",
  "content_hash":  "eedb095a3250ac8ca0c5929c4fabe4076c9ef43342801683ee88b64db8ee401b",
  "section_from":  "IPC:166A",
  "section_to":    "BNS:199",
  "punishment_text": "Rigorous imprisonment of at least six months and up to two years, and fine",
  ...
}
```

The `content_hash` field is:
```
SHA-256("IPC:166A->BNS:199")   # only the subject_key string
```

**Limitation**: the hash is bound only to the section-pair string.
If the `punishment_text` field is updated (e.g. a legal text correction), the
existing `content_hash` continues to "pass" because it was never computed from
the punishment text. The approval silently covers a different punishment than
the one originally approved.

---

## 2. Proposed Canonical JSON Schema

The new canonical record is a deterministic JSON object that binds the approval
to **all substantive claim fields**, not just the section pair:

```python
canonical_record = {
    "record_type":     "correspondence",
    "source_act":      "IPC",
    "source_section":  "166A",
    "target_act":      "BNS",
    "target_section":  "199",
    "punishment_text": "Rigorous imprisonment of at least six months and up to two years, and fine",
}

# Serialisation — MUST be used exactly:
import json, hashlib
canonical_json = json.dumps(canonical_record, sort_keys=True, separators=(',', ':'))
content_hash   = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
```

The `sort_keys=True` and explicit `separators` guarantee that the serialised
string is identical regardless of Python version, dictionary insertion order, or
whitespace differences. This is the **sole stable serialisation** to be used.

### New hash for REGISTRY-001 under the proposed schema

```python
canonical_record = {
    "punishment_text": "Rigorous imprisonment of at least six months and up to two years, and fine",
    "record_type":     "correspondence",
    "source_act":      "IPC",
    "source_section":  "166A",
    "target_act":      "BNS",
    "target_section":  "199",
}
# Serialises as (sort_keys=True, no spaces):
# {"punishment_text":"Rigorous imprisonment...","record_type":"correspondence","source_act":"IPC","source_section":"166A","target_act":"BNS","target_section":"199"}
```

> **Compute the new hash before opening a migration GO:**
> Run `python -c "import json,hashlib; print(hashlib.sha256(json.dumps({...}, sort_keys=True, separators=(',',':')).encode()).hexdigest())"` and record the result as the new `content_hash` value for the migrated record.

---

## 3. Migration Steps

The migration MUST be performed entirely out-of-band by the authorised
legal reviewer (currently: `callistus-moses-founder`). Engineering must
not touch the registry file.

### Step 1 — Prepare the new record (engineering, read-only)

Generate the new canonical JSON and hash for each existing `approvals[]` entry
and deliver the computed values to the authorised reviewer. Do **not** modify
the file at this stage.

### Step 2 — Reviewer creates a NEW record alongside the old one

The authorised reviewer MUST:
1. Keep the original REGISTRY-001 record **unchanged** with its original hash
   (provides a stable rollback point and an audit trail).
2. Add a NEW record with:
   - A new `approval_id` (e.g. `REGISTRY-002-IPC166A-BNS199`)
   - `content_hash` computed from the canonical JSON above
   - `_content_hash_note` documenting the new schema
   - `status: "active"`
   - Their own `reviewer_id` and `approved_at`

Example new record shape:

```json
{
  "approval_id":         "REGISTRY-002-IPC166A-BNS199",
  "batch":               "REGISTRY-002",
  "record_type":         "correspondence",
  "subject_key":         "IPC:166A->BNS:199",
  "section_from":        "IPC:166A",
  "section_to":          "BNS:199",
  "source_act":          "IPC",
  "source_section":      "166A",
  "target_act":          "BNS",
  "target_section":      "199",
  "punishment_text":     "Rigorous imprisonment of at least six months and up to two years, and fine",
  "content_hash":        "<NEW_SHA256_FROM_CANONICAL_JSON>",
  "reviewer_id":         "callistus-moses-founder",
  "approved_by":         "callistus-moses-founder",
  "status":              "active",
  "revoked":             false,
  "revoked_at":          null,
  "approved_at":         "<ISO8601_TIMESTAMP>",
  "_content_hash_note":  "SHA-256 of json.dumps({record_type, source_act, source_section, target_act, target_section, punishment_text}, sort_keys=True, separators=(',',':')) — UTF-8. Hash covers punishment_text; any text edit requires a new GO and new hash."
}
```

### Step 3 — Update `check_section_correspondence_approval` to accept both schemas

The gating function in `engine/approval_evidence.py` currently computes:
```python
content_hash = compute_content_hash(subject_key)   # SHA-256 of the string
```

After the migration, it must also try the new canonical JSON hash:
```python
new_hash = compute_canonical_json_hash(
    source_act=..., source_section=..., target_act=..., target_section=..., punishment_text=...
)
```

Records with the old subject_key hash continue to be accepted (REGISTRY-001
is read-only). Records with the new JSON hash are accepted through the new path.
Both paths fail closed on all existing failure conditions.

### Step 4 — Retire the old REGISTRY-001 record (only after Step 3 is live)

Once the new record (REGISTRY-002) is active and tested, the old REGISTRY-001
record is marked `status: "revoked"` with a `revoked_at` timestamp and a
`revocation_note` explaining the migration. It is **never deleted** (immutable
audit log).

---

## 4. What MUST NOT Happen

- No engineering agent or automated process may add entries to
  `approval_evidence_registry.json`. All writes are out-of-band by the
  authorised reviewer only.
- No migration may happen without an explicit GO instruction that names
  the specific approval_ids being migrated.
- The new hash schema MUST NOT be deployed until `check_section_correspondence_
  approval` is updated to accept both schemas — otherwise REGISTRY-001 loses
  its approval effect before the new record is populated.
- REGISTRY-001 must remain untouched until Step 3 has been merged, reviewed,
  and deployed to production.

---

## 5. Reference Implementation Sketch

```python
# engine/approval_evidence.py — new helper (NOT YET IMPLEMENTED)
import json as _json

def compute_canonical_json_hash(
    record_type: str,
    source_act: str,
    source_section: str,
    target_act: str,
    target_section: str,
    punishment_text: str,
) -> str:
    """Stable, sorted-key JSON hash for a correspondence approval record.

    This is the PROPOSED new content_hash scheme (see REGISTRY_MIGRATION_PROPOSAL.md).
    NOT used in production until a migration GO is issued.
    """
    canonical = {
        "punishment_text": (punishment_text or "").strip(),
        "record_type":     record_type,
        "source_act":      source_act,
        "source_section":  source_section,
        "target_act":      target_act,
        "target_section":  target_section,
    }
    serialised = _json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialised.encode("utf-8")).hexdigest()
```

---

## 6. Governance

| Action                          | Who                         | When                            |
|---------------------------------|-----------------------------|----------------------------------|
| Compute new hashes              | Engineering (read-only)     | On GO instruction                |
| Add REGISTRY-002 record         | Authorised reviewer only    | Out-of-band, after GO            |
| Update `approval_evidence.py`   | Engineering                 | On explicit GO, after reviewer   |
| Mark REGISTRY-001 as revoked    | Authorised reviewer only    | After Step 3 is live + verified  |

**No step may be performed out of this order.**

---

*Prepared as Phase 6 of the GO — DHARA P1 legal-release containment command.*
*No registry entries modified by this document.*
