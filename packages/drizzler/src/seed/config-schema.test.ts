import { describe, expect, it } from "vite-plus/test";
import { decodeSeedConfig } from "./config-schema.js";

const schema = { users: {} };

describe("decodeSeedConfig", () => {
  it("accepts a config of what drizzler seed takes", () => {
    const config = {
      schema,
      seed: 1,
      count: 5,
      nullRate: 0.2,
      dates: { from: "2026-01-01", to: "2026-12-31" },
      models: { users: { count: 3, fields: { name: (faker: unknown) => faker } } },
    };
    const decoded = decodeSeedConfig("a.ts", config);
    expect(decoded.ok).toBe(true);
  });

  it("names every problem by its path, an unknown key included", () => {
    const decoded = decodeSeedConfig("a.ts", {
      schema,
      count: -1,
      nullRate: 2,
      dates: { from: "2026-12-31", to: "2026-01-01" },
      typo: true,
    });
    expect(decoded.ok).toBe(false);
    const message = decoded.ok ? "" : decoded.error.message;
    expect(message.startsWith("Invalid config in a.ts:\n   ")).toBe(true);
    expect(message).toContain("count: ");
    expect(message).toContain("nullRate: ");
    expect(message).toContain("from at or before to");
    expect(message).toContain("typo: ");
  });

  it("says what a rule must be", () => {
    const decoded = decodeSeedConfig("a.ts", {
      schema,
      models: { users: { fields: { name: 1 } } },
    });
    expect(decoded.ok ? "" : decoded.error.message).toContain("models.users.fields.name: ");
  });

  it("needs the schema module, and says what it must be", () => {
    const missing = decodeSeedConfig("a.ts", {});
    expect(missing.ok ? "" : missing.error.message).toBe(
      "Invalid config in a.ts:\n   schema: Missing key",
    );
    const wrong = decodeSeedConfig("a.ts", { schema: 1 });
    expect(wrong.ok ? "" : wrong.error.message).toContain(
      "the schema module: import * as schema from './db/schema'",
    );
  });
});
