import { describe, expect, it } from "vite-plus/test";
import { studioBanner } from "./banner.js";

const at = { file: "db/schema.ts", host: "127.0.0.1", port: 4983 };

describe("studioBanner", () => {
  it("names the database it works on", () => {
    expect(
      studioBanner({
        ...at,
        status: { connected: true, dialect: "sqlite", url: "file:./dev.db", error: null },
      }),
    ).toBe(
      "💧 drizzler studio is editing db/schema.ts at http://127.0.0.1:4983\n   Database: file:./dev.db",
    );
  });

  it("says why it is not connected, and nothing without a database", () => {
    expect(
      studioBanner({
        ...at,
        status: { connected: false, dialect: "sqlite", url: "libsql://x", error: "fetch failed" },
      }),
    ).toContain("\n   Database not connected: fetch failed");
    expect(
      studioBanner({ ...at, status: { connected: false, dialect: null, url: null, error: null } }),
    ).toBe("💧 drizzler studio is editing db/schema.ts at http://127.0.0.1:4983");
  });
});
