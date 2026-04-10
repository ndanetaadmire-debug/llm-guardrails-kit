/** Map common homoglyphs (Cyrillic/Greek look-alikes, fullwidth, leetspeak) onto ASCII. */
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ı": "i", "ȷ": "j",
  "Α": "a", "Β": "b", "Ε": "e", "Ι": "i", "Ο": "o", "Ρ": "p", "Τ": "t", "ο": "o", "ι": "i",
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s",
};

const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤﻿]/g;

/**
 * Canonical form used for matching only (never shown to users or sent to models).
 * NFKC folds fullwidth/compatibility forms; invisible and bidi-control characters are stripped;
 * homoglyphs and leetspeak are mapped; whitespace and punctuation runs collapse.
 */
export function canonicalize(input: string): string {
  const nfkc = input.normalize("NFKC").replace(INVISIBLE, "").toLowerCase();
  let out = "";
  for (const ch of nfkc) out += HOMOGLYPHS[ch] ?? ch;
  return out.replace(/[\s_*~`|]+/g, " ").replace(/\s+/g, " ").trim();
}

export function hasInvisibleOrBidi(input: string): boolean {
  return new RegExp(INVISIBLE.source).test(input);
}
