import { describe, expect, it } from "vitest";
import { detectPii, ibanValid, luhn, PiiVault, redactForLogs, zaIdValid } from "../src/index.js";

describe("validators", () => {
  it("Luhn, SA ID and IBAN checksums", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("4111111111111112")).toBe(false);
    expect(zaIdValid("8001015009087")).toBe(true);
    expect(zaIdValid("8013015009087")).toBe(false); // month 13
    expect(ibanValid("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(ibanValid("GB82 WEST 1234 5698 7654 33")).toBe(false);
  });
});

describe("detection", () => {
  it("finds valid PII and ignores look-alikes that fail checksums", () => {
    const text = "Card 4111 1111 1111 1111, fake 1234 5678 9012 3456, ID 8001015009087, mail a.b@x.co.za, call +27 82 123 4567";
    const kinds = detectPii(text).map((m) => m.kind);
    expect(kinds).toEqual(["card", "za_id", "email", "phone"]);
  });

  it("does not treat order numbers or prices as PII", () => {
    expect(detectPii("Order #1042 costs R1 899.00")).toEqual([]);
  });
});

describe("reversible redaction", () => {
  it("swaps PII for stable placeholders and restores them in the reply", () => {
    const vault = new PiiVault();
    const redacted = vault.redact("I'm thandi@example.com, card 4111111111111111. Again: thandi@example.com");
    expect(redacted).toBe("I'm [EMAIL_1], card [CARD_1]. Again: [EMAIL_1]");
    expect(redacted).not.toContain("thandi");
    const modelReply = "Thanks [EMAIL_1], we never store [CARD_1].";
    expect(vault.restore(modelReply)).toBe("Thanks thandi@example.com, we never store 4111111111111111.");
    expect(vault.restore("Unknown [EMAIL_9] stays")).toBe("Unknown [EMAIL_9] stays");
  });

  it("one-way log redaction", () => {
    expect(redactForLogs("from 10.0.0.12 by a@b.io")).toBe("from [ipv4] by [email]");
  });
});
