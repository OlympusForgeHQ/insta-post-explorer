import { describe, expect, it } from "vitest";
import { compactCaption } from "@/lib/compact-caption";

describe("compact caption Unicode integrity", () => {
  it.each([
    ["A".repeat(499) + "🌍 suite", "A".repeat(499)],
    ["A".repeat(498) + "🌍 suite", "A".repeat(498) + "🌍"],
    ["Café 👩‍🍳", "Café 👩‍🍳"],
  ])("preserves complete Unicode at the card boundary", (input, expected) => {
    const result = compactCaption(input);
    expect(result).toBe(expected);
    // HTML encoding and the serialized React payload must produce identical text.
    expect(new TextDecoder().decode(new TextEncoder().encode(result))).toBe(result);
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
