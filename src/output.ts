import type { z } from "zod";

/**
 * Structured output with a bounded repair loop. Models are asked for JSON; if it fails to parse or
 * validate, the precise validation errors are fed back once or twice. After that we fail closed
 * rather than accept a guess.
 */
export class OutputValidationError extends Error {
  constructor(message: string, readonly attempts: number, readonly lastRaw: string) {
    super(message);
  }
}

export async function generateStructured<S extends z.ZodType>(
  schema: S,
  generate: (feedback: string | null) => Promise<string>,
  opts: { maxRepairs?: number } = {},
): Promise<{ value: z.infer<S>; attempts: number }> {
  const max = opts.maxRepairs ?? 2;
  let feedback: string | null = null;
  let raw = "";
  for (let attempt = 1; attempt <= max + 1; attempt++) {
    raw = await generate(feedback);
    const json = extractJson(raw);
    if (json === undefined) {
      feedback = "Your previous reply was not valid JSON. Reply with a single JSON object only.";
      continue;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) return { value: parsed.data, attempts: attempt };
    feedback = `Your JSON failed validation:\n${parsed.error.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n")}\nReturn corrected JSON only.`;
  }
  throw new OutputValidationError(`No valid output after ${max + 1} attempts`, max + 1, raw);
}

/** Accepts bare JSON or JSON inside a ```json fence; ignores surrounding prose. */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.search(/[[{]/);
  if (start < 0) return undefined;
  for (let end = candidate.length; end > start; end--) {
    const ch = candidate[end - 1];
    if (ch !== "}" && ch !== "]") continue;
    try {
      return JSON.parse(candidate.slice(start, end));
    } catch {
      /* try a shorter span */
    }
  }
  return undefined;
}

export interface ClaimRule {
  id: string;
  /** Pattern of a claim in the model's reply, e.g. "your refund is approved". */
  pattern: RegExp;
  /** The claim is allowed only if this returns true for the tool ledger. */
  backedBy: (ledger: LedgerEntry[]) => boolean;
  /** Replacement text when the claim is unbacked. */
  correction: string;
}

export interface LedgerEntry {
  tool: string;
  ok: boolean;
  data?: unknown;
}

/**
 * Ledger-checked claims: the model may only assert outcomes that a successful tool call produced.
 * This is the control that stops "you're booked" / "refund approved" hallucinations from reaching users.
 */
export function checkClaims(reply: string, ledger: LedgerEntry[], rules: ClaimRule[]): { reply: string; violations: string[] } {
  let out = reply;
  const violations: string[] = [];
  for (const r of rules) {
    if (r.pattern.test(out) && !r.backedBy(ledger)) {
      violations.push(r.id);
      out = out.replace(r.pattern, r.correction);
    }
  }
  return { reply: out, violations };
}

export const succeeded = (tool: string) => (ledger: LedgerEntry[]) => ledger.some((e) => e.tool === tool && e.ok);
