# DHARA Human Review Package — IPC § 166A → BNS § 199

**Package purpose:** Provide a complete record of the content that requires authorized human legal review before `REGISTRY-001-v1-IPC166A-BNS199` can be activated as a releasing approval.

**Approval ID:** `REGISTRY-001-v1-IPC166A-BNS199`
**Schema version:** `v1`
**Current status:** `pending_human_review`
**Prepared:** 2026-10-31T00:00:00+00:00 (Toronto / EDT) by DHARA P2 correction
**Prepared by:** automated gate (not a human reviewer — no authorization is granted herein)

---

## Section 1 — Canonical Record Content

These are the **seven fields** whose combined hash is stored in `content_hash`.  
**Do not change any field below without recomputing the hash and obtaining a new GO.**

| Field | Value |
|---|---|
| `schema_version` | `v1` |
| `source_act` | `IPC` |
| `source_section` | `166A` |
| `target_act` | `BNS` |
| `target_section` | `199` |
| `offence_text` | `Public servant disobeying direction under law` |
| `punishment_text` | `Rigorous imprisonment of at least six months and up to two years, and fine` |

---

## Section 2 — Canonical Serialised JSON

This is the exact JSON string that is hashed.  All keys are sorted; no spaces around `:` or `,`.

```json
{"offence_text":"Public servant disobeying direction under law","punishment_text":"Rigorous imprisonment of at least six months and up to two years, and fine","schema_version":"v1","source_act":"IPC","source_section":"166A","target_act":"BNS","target_section":"199"}
```

---

## Section 3 — Independently Calculated Hash

**Algorithm:** SHA-256 of the UTF-8 encoding of the serialised JSON above.

```
1787743a993d9df1f94c1addad280016fc1b565781d8a790d51fb273068f16f8
```

**Verification command (Python 3):**
```python
import hashlib, json
canonical = {
    "offence_text": "Public servant disobeying direction under law",
    "punishment_text": "Rigorous imprisonment of at least six months and up to two years, and fine",
    "schema_version": "v1",
    "source_act": "IPC",
    "source_section": "166A",
    "target_act": "BNS",
    "target_section": "199",
}
h = hashlib.sha256(
    json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
).hexdigest()
print(h)
# Expected: 1787743a993d9df1f94c1addad280016fc1b565781d8a790d51fb273068f16f8
```

---

## Section 4 — Pinpoint Official Sources

The reviewer must independently verify the mapping and text against these sources.

| Source | URL | Purpose |
|---|---|---|
| IPC § 166A (original) | https://legislative.gov.in/acts/the-indian-penal-code-1860/ | Confirm offence_text and punishment range |
| BNS § 199 (successor) | https://legislative.gov.in/acts/bharatiya-nyaya-sanhita-2023/ | Confirm successor section number and punishment text |
| NALSA / MHA guidance (if applicable) | https://www.nalsa.gov.in/ | Cross-reference for public servant disobedience in legal aid context |

**The reviewer must personally access and read these sources.  Links are provided as starting points only — the reviewer must not assume link content is current or complete.**

---

## Section 5 — Mapping, Offence and Punishment Text

### IPC § 166A — Offence
> "Public servant disobeying direction under law"

**IPC Punishment (as mapped):**
> Rigorous imprisonment of a term not less than six months, which may extend to two years, and shall also be liable to fine.

### BNS § 199 — Successor
> Section 199 of the Bharatiya Nyaya Sanhita, 2023 (successor to IPC § 166A)

**BNS Punishment (as mapped):**
> Rigorous imprisonment of at least six months and up to two years, and fine.

### What the reviewer must verify:
1. That IPC § 166A is correctly described by `offence_text` above.
2. That BNS § 199 is the direct and correct successor section.
3. That the `punishment_text` in this package accurately reflects both the IPC original and the BNS successor punishment as enacted.
4. That no material difference in offence scope or punishment range exists between IPC § 166A and BNS § 199 that would invalidate this direct correspondence.

---

## Section 6 — Guardian Card Claims Requiring Review

Ten rights-card scenarios currently hold placeholder reviewer data (`"DHARA legal desk"`, `"pending final advocate sign-off"`).  The following scenarios are in scope:

| Scenario Key | Rights Card Topic | Status |
|---|---|---|
| `fir_refusal` | FIR refusal by public servant | ⚠ AWAITING REVIEW |
| `dv_protection_order` | Domestic violence protection order | ⚠ AWAITING REVIEW |
| `maintenance_right` | Maintenance entitlement | ⚠ AWAITING REVIEW |
| `workplace_harassment` | Workplace sexual harassment (POSH) | ⚠ AWAITING REVIEW |
| `dowry_harassment` | Dowry harassment (§ 498A / BNS § 85) | ⚠ AWAITING REVIEW |
| `child_custody` | Child custody rights | ⚠ AWAITING REVIEW |
| `property_rights` | Matrimonial property and succession | ⚠ AWAITING REVIEW |
| `cyber_harassment` | Cyber-crime and online abuse | ⚠ AWAITING REVIEW |
| `sexual_assault` | Sexual assault and rape provisions | ⚠ AWAITING REVIEW |
| `children_safety` | Child safety (POCSO) | ⚠ AWAITING REVIEW |

For each scenario, the reviewer must verify that the section correspondences cited in the card are accurate and that no material legal claim is overstated.

---

## Section 7 — Reviewer Declaration Fields

**The reviewer must fill in all fields below out-of-band (not via this automated system) and provide a signed declaration before the approval can be activated.**

```
REVIEWER IDENTITY
=================
reviewer_id   : _______________________________________________
                (must match the reviewer_id in authorized_reviewers)
reviewer_name : _______________________________________________
role          : _______________________________________________
organisation  : _______________________________________________

REVIEW DECLARATION
==================
I confirm that I have personally accessed the official sources listed in
Section 4, read the statutory text of IPC § 166A and BNS § 199, and verified:

  [  ] offence_text is accurate
  [  ] BNS § 199 is the correct direct successor to IPC § 166A
  [  ] punishment_text correctly reflects both statutes
  [  ] No material scope or penalty difference affects this mapping
  [  ] I have independently calculated and verified the SHA-256 hash in Section 3
  [  ] Each rights card in Section 6 has been individually reviewed and its
       claims are accurate and not overstated

review_date   : ___________________________  (ISO-8601 with timezone, e.g. 2026-11-15T14:30:00+05:30)
signature     : _______________________________________________
               (physical or qualified electronic signature per applicable law)
artefact_url  : _______________________________________________
               (a durable, independently reachable URL documenting this review;
                must NOT be a link to this file or any auto-generated document)
```

---

## Section 8 — Approval and Rejection Fields

Once the declaration above is signed, the reviewer (or a separate deployment operator with written authorisation from the reviewer) must update `approval_evidence_registry.json` entry `REGISTRY-001-v1-IPC166A-BNS199` as follows:

**To APPROVE:**
```json
{
  "status": "active",
  "approved_at": "<ISO-8601 datetime with timezone from reviewer declaration>",
  "reviewer_id": "<reviewer_id from Section 7>",
  "review_date": "<review_date from Section 7>",
  "review_artefact_url": "<artefact_url from Section 7>"
}
```
Do NOT change `content_hash`, `canonical record` fields, `approval_id`, `schema_version`, `section_from`, or `section_to`.

**To REJECT:**
```json
{
  "status": "rejected",
  "rejected_at": "<ISO-8601 datetime with timezone>",
  "rejection_reason": "<concise explanation of what was inaccurate>"
}
```

**Revocation (post-activation):**
```json
{
  "status": "revoked",
  "revoked_at": "<ISO-8601 datetime with timezone>",
  "revocation_reason": "<reason>"
}
```
Setting `status` to anything other than `"active"` causes the release gate to withhold IPC:166A data immediately.

---

## Section 9 — What Is Withheld Until This Review Is Complete

Until `REGISTRY-001-v1-IPC166A-BNS199` is approved, the following fields are returned as `null` by the `/api/advocate/cross-reference` endpoint for any query that matches IPC § 166A:

- `new_section`
- `new_subsection`
- `offence`
- `what_changed`
- `source_link`
- `judicial_citation`
- `mapping_version`
- `review_source`
- `successor_act`
- `successor_section`

`review_status` is returned as `"withheld_pending_approval"`.  
`correspondence_approval` is returned as `"revoked"` (registry status is pending_human_review, which fails the active check).

---

*This package was generated automatically and does not constitute a legal opinion, an approval, or a recommendation.*  
*No reviewer identity, decision, date or signature has been pre-populated.*  
*File location: `/app/backend/data/HUMAN_REVIEW_PACKAGE.md`*
