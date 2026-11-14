import { describe, expect, it } from "vite-plus/test";
import { causeLines, errorMessage, errorWithCauses } from "./error-message.js";

describe("errorMessage", () => {
  it("is an Error's message, or anything else as text", () => {
    expect(errorMessage(new Error("bad", { cause: new Error("why") }))).toBe("bad");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("errorWithCauses", () => {
  it("says the reason under a network failure", () => {
    const error = new Error("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    expect(errorWithCauses(error)).toBe("fetch failed: connect ECONNREFUSED");
    expect(errorWithCauses("plain")).toBe("plain");
  });
});

describe("causeLines", () => {
  it("writes a query's causes on lines of their own, once", () => {
    const thrown = new Error("Failed query: select 1", { cause: new Error("no such table: x") });
    expect(causeLines(thrown)).toBe("Failed query: select 1\nno such table: x");
    expect(
      causeLines(new Error("no such table: x", { cause: new Error("no such table: x") })),
    ).toBe("no such table: x");
  });
});
