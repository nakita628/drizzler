import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { readEnv } from "./env.js";

describe("readEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads each variable by name, null for one that is not set", async () => {
    vi.stubEnv("DRIZZLER_TEST_SET", "value");
    expect(
      await Effect.runPromise(readEnv({ names: ["DRIZZLER_TEST_SET", "DRIZZLER_TEST_UNSET"] })),
    ).toStrictEqual({ DRIZZLER_TEST_SET: "value", DRIZZLER_TEST_UNSET: null });
  });
});
