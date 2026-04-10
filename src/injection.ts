import { canonicalize, hasInvisibleOrBidi } from "./normalize.js";

export interface InjectionSignal {
  id: string;
  weight: number;
  evidence: string;
}

export interface InjectionVerdict {
  score: number; // 0..1
  flagged: boolean;
  signals: InjectionSignal[];
}

interface Rule {
  id: string;
  weight: number;
  pattern: RegExp;
}

/**
 * Weighted signals instead of a single regex. Each rule is cheap and explainable; the score is
 * 1 − Π(1 − wᵢ) so independent weak signals add up without any single one saturating.
 * Rules match against the canonical form, so "ıgnore prevıous ınstructıons" and zero-width tricks fail.
 */
export const DEFAULT_RULES: Rule[] = [
  { id: "override", weight: 0.85, pattern: /\b(ignore|disregard|forget|override|bypass)\b.{0,30}\b(previous|prior|above|earlier|all|your|the|system)\b.{0,20}\b(instructions?|rules|prompts?|guidelines|directions|polic(y|ies))\b/ },
  { id: "new-instructions", weight: 0.55, pattern: /\b(new|updated|real|actual) (instructions?|rules|system prompt)\b/ },
  { id: "role-hijack", weight: 0.6, pattern: /\byou are (now|no longer) (an? |in )?(unrestricted|jailbroken|dan|evil|uncensored|unfiltered|developer mode|free of|bound by|an ai without)\b|\bact as (an? )?(unrestricted|jailbroken|dan|developer mode|admin|root)\b|\bdeveloper mode\b|\bdo anything now\b/ },
  { id: "prompt-exfiltration", weight: 0.7, pattern: /\b(reveal|print|show|repeat|output|leak|dump)\b.{0,25}\b(system|hidden|initial|original|secret)\b.{0,15}\b(prompt|instructions?|message|rules)\b/ },
  { id: "fake-delimiters", weight: 0.5, pattern: /<\s*\/?\s*(system|assistant|im_start|im_end|instructions?)\s*>|\[\s*\/?\s*(inst|system)\s*\]|^\s*(system|assistant)\s*:/m },
  { id: "secret-request", weight: 0.55, pattern: /\b(api[ -]?keys?|access tokens?|passwords?|credentials|env(ironment)? var(iable)?s?|secrets?)\b.{0,30}\b(give|send|show|print|list|tell|reveal)\b|\b(give|send|show|print|list|tell|reveal)\b.{0,30}\b(api[ -]?keys?|access tokens?|passwords?|credentials|secrets?)\b/ },
  { id: "tool-coercion", weight: 0.55, pattern: /\b(call|invoke|execute|run)\b.{0,20}\b(tool|function)\b.{0,40}\b(without|no) (asking|confirmation|checking)\b/ },
  { id: "exfil-url", weight: 0.6, pattern: /!\[[^\]]*\]\(https?:\/\/[^)]*\?(q|data|d|c)=/ },
];

export interface InjectionOptions {
  threshold?: number;
  rules?: Rule[];
}

export function scoreInjection(input: string, opts: InjectionOptions = {}): InjectionVerdict {
  const rules = opts.rules ?? DEFAULT_RULES;
  const threshold = opts.threshold ?? 0.5;
  const canon = canonicalize(input);
  const signals: InjectionSignal[] = [];

  for (const r of rules) {
    const m = canon.match(r.pattern);
    if (m) signals.push({ id: r.id, weight: r.weight, evidence: m[0].slice(0, 80) });
  }
  if (hasInvisibleOrBidi(input)) signals.push({ id: "invisible-chars", weight: 0.25, evidence: "zero-width or bidi control characters" });
  const b64 = input.match(/[A-Za-z0-9+/]{60,}={0,2}/);
  if (b64) {
    const decoded = safeBase64(b64[0]);
    if (decoded && rules.some((r) => r.pattern.test(canonicalize(decoded)))) {
      signals.push({ id: "encoded-payload", weight: 0.7, evidence: "base64 payload containing instructions" });
    }
  }

  const score = 1 - signals.reduce((acc, s) => acc * (1 - s.weight), 1);
  return { score: Math.round(score * 1000) / 1000, flagged: score >= threshold, signals };
}

function safeBase64(s: string): string | null {
  try {
    const out = Buffer.from(s, "base64").toString("utf8");
    return /^[\x09\x0A\x0D\x20-\x7E]+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}
