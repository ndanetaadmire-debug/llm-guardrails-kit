import { scoreInjection, type InjectionOptions } from "./injection.js";
import { checkClaims, type ClaimRule, type LedgerEntry } from "./output.js";
import { PiiVault, type PiiKind } from "./pii.js";

export type GuardEvent =
  | { stage: "input"; type: "blocked"; reason: string; score: number }
  | { stage: "input"; type: "redacted"; count: number }
  | { stage: "output"; type: "claim_corrected"; rules: string[] }
  | { stage: "output"; type: "restored" };

export interface GuardrailConfig {
  maxInputChars?: number;
  injection?: InjectionOptions;
  redact?: PiiKind[] | false;
  claims?: ClaimRule[];
  onEvent?: (e: GuardEvent) => void;
}

/**
 * One object per conversation wrapping the model call:
 *   inbound(userText)  → block, or redacted text for the model
 *   outbound(reply)    → claim-checked, PII-restored text for the user
 */
export class Guardrails {
  readonly vault = new PiiVault();

  constructor(private readonly cfg: GuardrailConfig = {}) {}

  inbound(text: string): { ok: true; text: string } | { ok: false; reason: string } {
    const max = this.cfg.maxInputChars ?? 4000;
    if (text.length > max) return this.block("input_too_long", 1);
    const verdict = scoreInjection(text, this.cfg.injection);
    if (verdict.flagged) return this.block(`prompt_injection:${verdict.signals.map((s) => s.id).join(",")}`, verdict.score);
    if (this.cfg.redact === false) return { ok: true, text };
    const before = this.vault.size;
    const redacted = this.vault.redact(text, this.cfg.redact);
    if (this.vault.size > before) this.cfg.onEvent?.({ stage: "input", type: "redacted", count: this.vault.size - before });
    return { ok: true, text: redacted };
  }

  outbound(reply: string, ledger: LedgerEntry[] = []): string {
    const { reply: checked, violations } = checkClaims(reply, ledger, this.cfg.claims ?? []);
    if (violations.length) this.cfg.onEvent?.({ stage: "output", type: "claim_corrected", rules: violations });
    const restored = this.vault.restore(checked);
    if (restored !== checked) this.cfg.onEvent?.({ stage: "output", type: "restored" });
    return restored;
  }

  private block(reason: string, score: number) {
    this.cfg.onEvent?.({ stage: "input", type: "blocked", reason, score });
    return { ok: false as const, reason };
  }
}
