/**
 * Talk to DHARA — AudioResourceArbiter (C15 v3).
 *
 * One microphone owner at a time, across the whole app. Today six screens
 * each create their own expo-audio recorder (home chat, lookup, FIR draft,
 * intake, visitor interpreter, Evidence Locker) with nothing coordinating
 * them. Every recorder should claim the mic here first.
 *
 * Rules:
 *  - The Evidence Locker always wins. If it claims while another owner holds
 *    the mic, that owner's onPreempt callback runs synchronously and its claim
 *    is revoked before the Locker gets the mic.
 *  - Nobody else may claim while the Evidence Locker holds the mic.
 *  - Claims are synchronous, so two callers can never both succeed
 *    (JavaScript runs one task at a time).
 *
 * Pure TypeScript, no Expo imports. The caller still starts/stops its own
 * expo-audio recorder; this module only decides who may.
 */

export type MicOwner =
  | 'evidence_locker'
  | 'voice_session'
  | 'chat_mic'
  | 'lookup_mic'
  | 'fir_draft_mic'
  | 'intake_mic'
  | 'interpreter_mic';

export type MicClaim = {
  readonly id: number;
  readonly owner: MicOwner;
  /** True until released or preempted. */
  readonly active: boolean;
};

export type ClaimResult =
  | { ok: true; claim: MicClaim }
  | { ok: false; reason: 'held_by_evidence_locker' | 'held_by_other'; holder: MicOwner };

type InternalClaim = { id: number; owner: MicOwner; active: boolean; onPreempt?: () => void };

export class AudioResourceArbiter {
  private holder: InternalClaim | null = null;
  private nextId = 1;

  /** Who holds the mic right now, or null. */
  get currentOwner(): MicOwner | null {
    return this.holder?.owner ?? null;
  }

  /**
   * Try to take the microphone.
   * `onPreempt` is called if the Evidence Locker later takes the mic away;
   * the caller must stop its recorder there.
   */
  claim(owner: MicOwner, onPreempt?: () => void): ClaimResult {
    const h = this.holder;
    if (h && h.active) {
      if (h.owner === owner) {
        // Same owner re-claiming: replace the old claim (e.g. a retry).
        h.active = false;
      } else if (owner === 'evidence_locker') {
        // Locker wins: revoke the current holder first.
        h.active = false;
        try {
          h.onPreempt?.();
        } catch {
          // A failing callback must never block evidence capture.
        }
      } else {
        return {
          ok: false,
          reason: h.owner === 'evidence_locker' ? 'held_by_evidence_locker' : 'held_by_other',
          holder: h.owner,
        };
      }
    }
    const claim: InternalClaim = { id: this.nextId++, owner, active: true, onPreempt };
    this.holder = claim;
    return { ok: true, claim: this.view(claim) };
  }

  /** Give the mic back. Safe to call twice or after preemption. */
  release(claim: MicClaim): void {
    const h = this.holder;
    if (h && h.id === claim.id) {
      h.active = false;
      this.holder = null;
    }
  }

  /** Is this claim still the active holder? Check before recorder.record(). */
  isActive(claim: MicClaim): boolean {
    return !!this.holder && this.holder.id === claim.id && this.holder.active;
  }

  private view(c: InternalClaim): MicClaim {
    const self = this;
    return {
      id: c.id,
      owner: c.owner,
      get active() {
        return self.isActive({ id: c.id, owner: c.owner, active: true });
      },
    };
  }
}

/** One shared instance for the whole app. */
export const micArbiter = new AudioResourceArbiter();
