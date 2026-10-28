/**
 * Talk to DHARA — AudioResourceArbiter (C15 v4).
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
 *  - Owner stack (P1 fix): when Evidence Locker preempts a holder, that
 *    holder's onRestore callback is saved.  When Evidence Locker releases,
 *    onRestore fires so the preempted screen can automatically restart.
 *    Only one level of stack is needed (only Evidence Locker can preempt).
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

/** Options accepted by claim(). */
export type ClaimOpts = {
  /** Called when the Evidence Locker takes the mic away — stop the recorder here. */
  onPreempt?: () => void;
  /** Called when the Evidence Locker releases the mic — restart recording here. */
  onRestore?: () => void;
};

type InternalClaim = {
  id: number;
  owner: MicOwner;
  active: boolean;
  onPreempt?: () => void;
  onRestore?: () => void;
};

export class AudioResourceArbiter {
  private holder: InternalClaim | null = null;
  private nextId = 1;
  /**
   * One-slot owner stack: when Evidence Locker preempts a holder we save
   * that holder's restore callback here. Cleared when Evidence Locker releases.
   */
  private restorable: { owner: MicOwner; onRestore?: () => void } | null = null;

  /** Who holds the mic right now, or null. */
  get currentOwner(): MicOwner | null {
    return this.holder?.owner ?? null;
  }

  /**
   * Try to take the microphone.
   *
   * opts.onPreempt — fired synchronously if Evidence Locker later takes the mic.
   * opts.onRestore — fired synchronously when Evidence Locker releases AND this
   *                  owner was the one who was preempted.
   *
   * For backward compatibility a bare function is still accepted in place of
   * opts (treated as onPreempt).
   */
  claim(owner: MicOwner, opts?: ClaimOpts | (() => void)): ClaimResult {
    // Normalize backward-compat: bare function → onPreempt
    const claimOpts: ClaimOpts =
      typeof opts === 'function' ? { onPreempt: opts } : (opts ?? {});

    const h = this.holder;
    if (h && h.active) {
      if (h.owner === owner) {
        // Same owner re-claiming: replace the old claim (e.g. a retry).
        h.active = false;
        // Preserve any existing restorable slot for this owner.
      } else if (owner === 'evidence_locker') {
        // Locker wins: revoke the current holder first.
        h.active = false;
        // Save the preempted owner so we can restore them on release.
        this.restorable = { owner: h.owner, onRestore: h.onRestore };
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
    const claim: InternalClaim = {
      id: this.nextId++,
      owner,
      active: true,
      onPreempt: claimOpts.onPreempt,
      onRestore: claimOpts.onRestore,
    };
    this.holder = claim;
    return { ok: true, claim: this.view(claim) };
  }

  /** Give the mic back. Safe to call twice or after preemption. */
  release(claim: MicClaim): void {
    const h = this.holder;
    if (h && h.id === claim.id) {
      const wasLocker = h.owner === 'evidence_locker';
      h.active = false;
      this.holder = null;

      // Owner stack (P1 fix): if Evidence Locker is releasing and there is a
      // preempted owner waiting to be restored, call their onRestore callback.
      if (wasLocker && this.restorable) {
        const { onRestore } = this.restorable;
        this.restorable = null;
        try {
          onRestore?.();
        } catch {
          // A failing restore callback must never crash the release path.
        }
      }
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
