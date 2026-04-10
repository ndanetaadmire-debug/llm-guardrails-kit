/**
 * Tool-call policy: an allowlist with per-tool argument constraints, per-session call budgets,
 * and human-approval gates. Evaluated *before* a tool runs, so a compromised or confused model
 * can only do what policy allows, however it was prompted.
 */
export interface ToolRule {
  /** Max calls of this tool per session. */
  maxCalls?: number;
  /** Return a reason string to deny, or null to allow. */
  validate?: (args: Record<string, unknown>) => string | null;
  /** If this returns true the call is held for a human instead of executed. */
  requiresApproval?: (args: Record<string, unknown>) => boolean;
}

export type ToolDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "approve"; reason: string };

export class ToolPolicy {
  private readonly counts = new Map<string, number>();
  private total = 0;

  constructor(private readonly rules: Record<string, ToolRule>, private readonly maxTotalCalls = 20) {}

  evaluate(tool: string, args: Record<string, unknown>): ToolDecision {
    const rule = this.rules[tool];
    if (!rule) return { action: "deny", reason: `tool "${tool}" is not allowlisted` };
    if (this.total >= this.maxTotalCalls) return { action: "deny", reason: "session tool budget exhausted" };
    const used = this.counts.get(tool) ?? 0;
    if (rule.maxCalls !== undefined && used >= rule.maxCalls) return { action: "deny", reason: `"${tool}" call limit (${rule.maxCalls}) reached` };
    const invalid = rule.validate?.(args);
    if (invalid) return { action: "deny", reason: invalid };
    this.counts.set(tool, used + 1);
    this.total++;
    if (rule.requiresApproval?.(args)) return { action: "approve", reason: `"${tool}" requires human approval` };
    return { action: "allow" };
  }
}

/** Common validators. */
export const validators = {
  /** Value must have been typed by the user — stops the model inventing recipients, accounts, etc. */
  userSupplied: (field: string, userText: () => string) => (args: Record<string, unknown>) => {
    const v = args[field];
    return typeof v === "string" && userText().toLowerCase().includes(v.toLowerCase()) ? null : `"${field}" was not provided by the user`;
  },
  maxNumber: (field: string, max: number) => (args: Record<string, unknown>) =>
    typeof args[field] === "number" && (args[field] as number) <= max ? null : `"${field}" must be a number ≤ ${max}`,
  domainAllowlist: (field: string, domains: string[]) => (args: Record<string, unknown>) => {
    try {
      const host = new URL(String(args[field])).hostname;
      return domains.some((d) => host === d || host.endsWith(`.${d}`)) ? null : `domain ${host} is not allowed`;
    } catch {
      return `"${field}" is not a valid URL`;
    }
  },
};
