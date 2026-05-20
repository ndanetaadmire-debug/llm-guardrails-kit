# llm-guardrails-kit

[![CI](https://github.com/ndanetaadmire-debug/llm-guardrails-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ndanetaadmire-debug/llm-guardrails-kit/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Coverage](https://img.shields.io/badge/coverage-96%25-brightgreen)
![Deps](https://img.shields.io/badge/runtime%20deps-0%20(zod%20peer)-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

**Deterministic guardrails for LLM apps and agents.** These are the controls I run in production agents (see [victor-ai-agent](https://github.com/ndanetaadmire-debug/victor-ai-agent) and [commerce-ops-agent](https://github.com/ndanetaadmire-debug/commerce-ops-agent)), extracted into a small, tested, framework-agnostic library.

Guardrails here are **code, not prompts**: they run before and after the model, cost no tokens, behave the same every time, and can't be talked around.

| Module | What it does |
|---|---|
| `scoreInjection` | Weighted, explainable prompt-injection scoring over a canonical form that defeats zero-width characters, homoglyphs, fullwidth text, leetspeak and base64-wrapped payloads |
| `PiiVault` | **Reversible** redaction: emails, phones, cards, SA ID numbers and IBANs become stable placeholders before the model sees them, and are restored in the reply. **Checksums** (Luhn, SA ID, IBAN mod-97) keep false positives down |
| `ToolPolicy` | Allowlist, per-tool and per-session budgets, argument validators (`userSupplied`, `maxNumber`, `domainAllowlist`), human-approval gates |
| `generateStructured` | Schema-enforced JSON output with a bounded repair loop that feeds back exact validation errors, then **fails closed** |
| `checkClaims` | **Ledger-checked claims**: "your refund is approved" is corrected unless a successful tool call backs it |
| `Guardrails` | Composes all of the above per conversation, with an audit event stream |

## Quick start

```ts
import { Guardrails, succeeded, ToolPolicy, validators } from "@ndaneta/llm-guardrails-kit";

const guard = new Guardrails({
  claims: [{ id: "refund", pattern: /refund (has been|is) approved/i, backedBy: succeeded("refund"),
             correction: "refund request is with our team" }],
  onEvent: (e) => logger.info(e),               // blocked / redacted / claim_corrected / restored
});

const inbound = guard.inbound(userMessage);
if (!inbound.ok) return safeReply(inbound.reason);         // injection blocked: zero tokens spent
const reply = await llm(inbound.text);                     // model sees [EMAIL_1], never the address
return guard.outbound(reply, toolLedger);                  // unbacked claims fixed, PII restored
```

```ts
const policy = new ToolPolicy({
  refund:     { validate: validators.maxNumber("amount", 5000), requiresApproval: (a) => a.amount > 500 },
  send_email: { validate: validators.userSupplied("to", () => conversationUserText) },
  fetch_url:  { validate: validators.domainAllowlist("url", ["shopify.com"]) },
}, /* max tool calls per session */ 20);

policy.evaluate("send_email", { to: "attacker@evil.com" });
// → { action: "deny", reason: '"to" was not provided by the user' }
```

Runnable: [`examples/agent-loop.ts`](examples/agent-loop.ts).

## Measured, not claimed

`test/corpus/` holds a labelled set of attack and benign messages: role hijacks, prompt exfiltration, fake `<system>` delimiters, Unicode and leetspeak obfuscation, base64 payloads and markdown-image exfiltration, alongside realistic customer messages that *look* risky ("please ignore my previous message", "print my invoice", "you are now my favourite shop!").

CI fails if **recall drops below 95%** or **any benign message is flagged**. Today: 20/20 attacks caught, 0/20 false positives. Coverage thresholds are enforced (≥ 90% lines).

Adding a rule is a one-line change plus corpus entries, so regressions show up as a red build, not a production incident.

## Design notes

- **Scoring, not a single regex.** `score = 1 − Π(1 − wᵢ)` lets weak independent signals combine without any one saturating, and every verdict lists the signals and evidence behind it, which makes triage and tuning straightforward.
- **Canonicalise for matching only.** NFKC, invisible and bidi stripping, and homoglyph mapping are applied to a copy used for detection; the user's text is never altered.
- **Same value, same placeholder.** The model can still reason that two mentions are the same person without seeing who it is.
- **Defence in depth.** Input scoring will never be perfect, which is why tool policy and claim checking exist: a successful injection still can't call a tool it isn't allowed to, or make the user believe something that didn't happen.

## Scripts

```bash
npm ci
npm test            # 19 tests incl. corpus precision/recall gates
npm run ci          # typecheck + coverage thresholds + build
```

---

Built by **[Admire T. Ndaneta](https://admire-portfolio.vercel.app)**. MIT licensed.
