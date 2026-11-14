import { describe, expect, it } from "vite-plus/test";
import { durationMs } from "./duration.js";

describe("durationMs", () => {
  it.each([
    [1.234567, 1.23],
    [0.004, 0],
    [0.005, 0.01],
    [1500, 1500],
  ])("shows %d ms as %d", (millis, shown) => {
    expect(durationMs(millis)).toBe(shown);
  });
});
