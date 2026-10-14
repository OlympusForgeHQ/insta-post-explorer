import { describe, expect, it } from "vitest";
import { cssDurationMs } from "@/lib/motion";

describe("CSS motion duration", () => {
  it("preserves time when CSS tooling converts milliseconds to seconds", () => {
    expect(cssDurationMs("520ms", 180)).toBe(520);
    expect(cssDurationMs(" .52s ", 180)).toBe(520);
    expect(cssDurationMs("0.18s", 360)).toBe(180);
    expect(cssDurationMs("0ms", 180)).toBe(0);
    expect(cssDurationMs("", 180)).toBe(180);
  });
});
