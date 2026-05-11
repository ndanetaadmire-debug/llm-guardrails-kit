// How the kit wraps a model call in an agent. Run: npx tsx examples/agent-loop.ts
import { Guardrails, succeeded, ToolPolicy, validators } from "../src/index.js";

const userText = "My order #1042 arrived damaged. Refund R350 to lerato@shop.co please.";
const guard = new Guardrails({
  claims: [{ id: "refund", pattern: /refund (has been|is) (approved|processed)/i, backedBy: succeeded("refund"), correction: "refund request is with our team" }],
  onEvent: (e) => console.log("guard event:", e),
});
const policy = new ToolPolicy({
  lookup_order: { maxCalls: 3 },
  refund: { validate: validators.maxNumber("amount", 5000), requiresApproval: (a) => (a.amount as number) > 500 },
  send_email: { validate: validators.userSupplied("to", () => userText) },
});

const inbound = guard.inbound(userText);
if (!inbound.ok) throw new Error(inbound.reason);
console.log("model sees:", inbound.text);                      // email replaced with [EMAIL_1]
console.log("refund R350:", policy.evaluate("refund", { amount: 350 }));
console.log("email attacker:", policy.evaluate("send_email", { to: "x@evil.com" }));
console.log("user sees:", guard.outbound("Sorry! Your refund has been processed, [EMAIL_1].", [{ tool: "refund", ok: true }]));
