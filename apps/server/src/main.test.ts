import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { resolveBooleanFlag } from "./main";

describe("resolveBooleanFlag", () => {
  it("preserves an explicit false flag override", () => {
    expect(resolveBooleanFlag(Option.some(false), true, false)).toBe(false);
  });

  it("falls back to the environment value when the flag is unset", () => {
    expect(resolveBooleanFlag(Option.none(), true, false)).toBe(true);
  });

  it("falls back to the provided default when both flag and env are unset", () => {
    expect(resolveBooleanFlag(Option.none(), undefined, false)).toBe(false);
  });
});
