import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import { costEstimate } from "../src/estimate.js";

describe("costEstimate", () => {
  const cfg = resolveConfig({ llm: { concurrency: 4 } });
  it("prices a novel and gates on confirmAboveChars", () => {
    const est = { units: 100, segments: 325, chars: 650000, est_prompt_tokens: 2275000, est_completion_tokens: 2340000 };
    const c = costEstimate(est, cfg);
    expect(c.usd).toBeCloseTo(2275000 / 1e6 * 0.28 + 2340000 / 1e6 * 0.42, 3);
    expect(c.needsConfirmation).toBe(true);
    expect(c.minutes[0]).toBeGreaterThanOrEqual(30);
    expect(costEstimate(est, cfg, { confirm: true }).needsConfirmation).toBe(false);
    expect(c.summary).toMatch(/100 unit/);
  });
  it("small texts need no confirmation", () => {
    expect(costEstimate({ units: 1, chars: 500, est_prompt_tokens: 1750, est_completion_tokens: 1800 }, cfg).needsConfirmation).toBe(false);
  });
});
