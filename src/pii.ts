/**
 * PII detection with checksum validation (fewer false positives than plain regex),
 * and *reversible* redaction: sensitive values are swapped for stable placeholders before
 * text reaches a model or a log, and restored in the model's reply for the end user.
 */
export type PiiKind = "email" | "phone" | "card" | "za_id" | "iban" | "ipv4";

export interface PiiMatch {
  kind: PiiKind;
  value: string;
  start: number;
  end: number;
}

const DETECTORS: Array<{ kind: PiiKind; re: RegExp; valid?: (v: string) => boolean }> = [
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "iban", re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, valid: ibanValid },
  { kind: "za_id", re: /\b\d{13}\b/g, valid: zaIdValid },
  { kind: "card", re: /\b(?:\d[ -]?){12,18}\d\b/g, valid: (v) => luhn(digits(v)) && digits(v).length >= 13 },
  { kind: "phone", re: /(?:\+\d{1,3}[ -]?)?(?:\(?\d{2,4}\)?[ -]?){2,4}\d{3,4}\b/g, valid: (v) => digits(v).length >= 9 && digits(v).length <= 15 },
  { kind: "ipv4", re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

export function detectPii(text: string, kinds?: PiiKind[]): PiiMatch[] {
  const found: PiiMatch[] = [];
  for (const d of DETECTORS) {
    if (kinds && !kinds.includes(d.kind)) continue;
    for (const m of text.matchAll(d.re)) {
      const value = m[0].trim();
      if (d.valid && !d.valid(value)) continue;
      const start = m.index!;
      found.push({ kind: d.kind, value, start, end: start + m[0].length });
    }
  }
  // Resolve overlaps: earlier detectors (more specific) win; then by length.
  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: PiiMatch[] = [];
  for (const m of found) if (!out.some((o) => m.start < o.end && o.start < m.end)) out.push(m);
  return out;
}

/** Holds placeholder ↔ value mappings for one conversation. Never persist it alongside the redacted text. */
export class PiiVault {
  private readonly forward = new Map<string, string>();
  private readonly backward = new Map<string, string>();
  private readonly counters = new Map<PiiKind, number>();

  redact(text: string, kinds?: PiiKind[]): string {
    let out = "";
    let cursor = 0;
    for (const m of detectPii(text, kinds)) {
      out += text.slice(cursor, m.start) + this.placeholder(m.kind, m.value);
      cursor = m.end;
    }
    return out + text.slice(cursor);
  }

  restore(text: string): string {
    return text.replace(/\[(EMAIL|PHONE|CARD|ZA_ID|IBAN|IPV4)_(\d+)\]/g, (ph) => this.backward.get(ph) ?? ph);
  }

  get size(): number {
    return this.forward.size;
  }

  private placeholder(kind: PiiKind, value: string): string {
    const key = `${kind}:${value.replace(/\s+/g, "").toLowerCase()}`;
    const existing = this.forward.get(key);
    if (existing) return existing; // same value → same placeholder, so the model can still reason about identity
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    const ph = `[${kind.toUpperCase()}_${n}]`;
    this.forward.set(key, ph);
    this.backward.set(ph, value);
    return ph;
  }
}

/** One-way redaction for logs and traces. */
export function redactForLogs(text: string): string {
  let out = "";
  let cursor = 0;
  for (const m of detectPii(text)) {
    out += text.slice(cursor, m.start) + `[${m.kind}]`;
    cursor = m.end;
  }
  return out + text.slice(cursor);
}

const digits = (s: string) => s.replace(/\D/g, "");

export function luhn(num: string): boolean {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return num.length > 0 && sum % 10 === 0;
}

/** South African ID: YYMMDD + 4 + citizenship (0/1) + 8 + Luhn check digit. */
export function zaIdValid(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  if (id[10] !== "0" && id[10] !== "1") return false;
  return luhn(id);
}

export function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
